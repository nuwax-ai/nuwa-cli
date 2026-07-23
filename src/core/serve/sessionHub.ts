import * as crypto from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  AGENT_METHODS,
  type ClientContext,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type McpServer,
  type SessionModeState,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { getEngine } from "../engines/registry.js";
import {
  buildEngineEnv,
  type EngineKind,
  type ModelOverlay,
} from "../env/inheritEnv.js";
import { withEngineConnection } from "../acp/connection.js";
import {
  wrapNewSession,
  wrapResumedSession,
  type SessionHandle,
} from "../acp/sessionHandle.js";
import { applySessionMode } from "../acp/sessionMode.js";
import { debugLog } from "../debugLog.js";
import { modelFromConfigOptions } from "../ui/modelInfo.js";
import type { LocalSessionSummary } from "../sessions/discovery.js";
import type { PermissionMode } from "../permissions/policy.js";
import {
  createDefaultCoordinator,
  type PermissionCoordinator,
} from "../permissions/coordinator.js";
import { ApprovalPendingService } from "../permissions/approvalPending.js";
import { toComputerPermissionProgressData } from "../permissions/notifyResolved.js";
import {
  buildSyntheticPermissionRequest,
  responseAllowsAccess,
} from "../permissions/syntheticRequest.js";
import { AsyncQueue } from "./asyncQueue.js";

export interface UnifiedSessionMessage {
  sessionId: string;
  acpSessionId?: string;
  messageType:
    | "sessionPromptStart"
    | "sessionPromptEnd"
    | "agentSessionUpdate"
    | "acpRequestPermission"
    | "sessionReady"
    | "sessionState"
    | "heartbeat";
  subType: string;
  data: unknown;
  timestamp: string;
}

/** Control surface for a live session — rides the same ACP connection. */
export interface SessionControls {
  setMode(modeId: string): Promise<void>;
  setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<SessionConfigOption[]>;
}

/** Mode/yolo knobs applied once when a session becomes ready. */
export interface SessionRuntimeOptions {
  mode?: string;
  yolo?: boolean;
  /** Per-session ACP model settings override Gateway flags and local config. */
  modelOverlay?: ModelOverlay;
  /** Per-session ACP environment is applied last to the engine process. */
  engineEnv?: NodeJS.ProcessEnv;
  /** Forwarded unchanged in ACP session/new or session/load. */
  mcpServers?: McpServer[];
}

type Readiness = { ok: true } | { ok: false; error: string };

interface ManagedSession {
  sessionId: string;
  engine: EngineKind;
  cwd: string;
  userId?: string;
  projectId?: string;
  queue: AsyncQueue<string>;
  sseClients: Set<ServerResponse>;
  /** Aborted by stopSession/stopAll to interrupt an in-flight prompt. */
  abortController: AbortController;
  ready: Promise<Readiness>;
  readyResolve: (v: Readiness) => void;
  readyOk?: boolean;
  /** Guards setReady against firing twice (success then later connection-drop). */
  readySet?: boolean;
  done: Promise<void>;
  /** ACP session id once the engine session is created/loaded. */
  acpSessionId?: string;
  modes?: SessionModeState | null;
  configOptions?: SessionConfigOption[] | null;
  controls?: SessionControls;
  initialModeId?: string;
  yolo?: boolean;
  modelOverlay?: ModelOverlay;
  engineEnv?: NodeJS.ProcessEnv;
  mcpServers: McpServer[];
}

function mergeModelOverlay(
  gateway: ModelOverlay | undefined,
  session: ModelOverlay | undefined,
): ModelOverlay | undefined {
  const merged = { ...gateway, ...session };
  return Object.values(merged).some(Boolean) ? merged : undefined;
}

function sendSseEvent(
  res: ServerResponse,
  eventName: string,
  message: UnifiedSessionMessage,
): void {
  try {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(message)}\n\n`);
  } catch {
    // client disconnected mid-write; registerSseClient's own close handler
    // (or terminateSession) will clean it up.
  }
}

export interface SessionHubOptions {
  permissionMode: PermissionMode;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
  coordinator?: PermissionCoordinator;
  pending?: ApprovalPendingService;
}

export class SessionHub {
  private sessions = new Map<string, ManagedSession>();
  /** 无对应 ManagedSession 时仍可挂的审批 SSE（例如测试，或未来全局 permission 流）。 */
  private looseSseClients = new Set<ServerResponse>();
  readonly coordinator: PermissionCoordinator;
  readonly pending: ApprovalPendingService;
  private permissionMode: PermissionMode;
  private overlay?: { apiKey?: string; baseUrl?: string; model?: string };

  constructor(
    permissionModeOrOptions: PermissionMode | SessionHubOptions,
    overlay?: { apiKey?: string; baseUrl?: string; model?: string },
  ) {
    // 兼容旧构造：new SessionHub(mode, overlay)
    if (typeof permissionModeOrOptions === "string") {
      this.permissionMode = permissionModeOrOptions;
      this.overlay = overlay;
      this.coordinator = createDefaultCoordinator();
      this.pending = new ApprovalPendingService();
    } else {
      this.permissionMode = permissionModeOrOptions.permissionMode;
      this.overlay = permissionModeOrOptions.overlay;
      this.coordinator =
        permissionModeOrOptions.coordinator ?? createDefaultCoordinator();
      this.pending =
        permissionModeOrOptions.pending ?? new ApprovalPendingService();
    }
  }

  private broadcast(
    sessionId: string,
    eventName: string,
    message: UnifiedSessionMessage,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const client of session.sseClients)
      sendSseEvent(client, eventName, message);
  }

  /** Marks readiness and emits a one-shot `session_ready` SSE event. Idempotent. */
  private setReady(session: ManagedSession, result: Readiness): void {
    // Fire only once: on a later connection drop the runner's .catch calls
    // setReady({ok:false}) again, but the promise is already resolved and the
    // session is about to be terminated — a second event would just confuse
    // clients that already saw ok:true (and readyResolve is a no-op anyway).
    if (session.readySet) {
      session.readyOk = result.ok;
      return;
    }
    session.readySet = true;
    session.readyOk = result.ok;
    this.broadcast(session.sessionId, "session_ready", {
      sessionId: session.sessionId,
      acpSessionId: session.acpSessionId,
      messageType: "sessionReady",
      subType: result.ok ? "ready" : "error",
      data: result.ok ? { ok: true } : { ok: false, error: result.error },
      timestamp: new Date().toISOString(),
    });
    session.readyResolve(result);
  }

  /** Emits a `session_state` snapshot (modes / configOptions / model). */
  private broadcastState(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.broadcast(sessionId, "session_state", {
      sessionId,
      acpSessionId: session.acpSessionId,
      messageType: "sessionState",
      subType: "state",
      data: {
        modes: session.modes ?? null,
        configOptions: session.configOptions ?? null,
        model: modelFromConfigOptions(session.configOptions),
      },
      timestamp: new Date().toISOString(),
    });
  }

  private buildControls(
    ctx: ClientContext,
    acpSessionId: string,
  ): SessionControls {
    return {
      setMode: (modeId) =>
        ctx
          .request(AGENT_METHODS.session_set_mode, {
            sessionId: acpSessionId,
            modeId,
          })
          .then(() => undefined),
      setConfigOption: (configId, value) =>
        ctx
          .request(AGENT_METHODS.session_set_config_option, {
            sessionId: acpSessionId,
            configId,
            // Boolean options carry their value in a typed wrapper; select
            // options (model/mode/...) send a bare value id.
            value:
              typeof value === "boolean" ? { value, type: "boolean" } : value,
          })
          .then(
            (r) =>
              (r as { configOptions?: SessionConfigOption[] }).configOptions ??
              [],
          ),
    };
  }

  private createManagedSession(
    engineId: EngineKind,
    cwd: string,
    metadata: { userId?: string; projectId?: string } | undefined,
    runtime: SessionRuntimeOptions | undefined,
  ): ManagedSession {
    const sessionId = crypto.randomUUID();
    let readyResolve!: (v: Readiness) => void;
    const ready = new Promise<Readiness>((resolve) => {
      readyResolve = resolve;
    });
    return {
      sessionId,
      engine: engineId,
      cwd,
      userId: metadata?.userId,
      projectId: metadata?.projectId,
      queue: new AsyncQueue<string>(),
      sseClients: new Set(),
      abortController: new AbortController(),
      ready,
      readyResolve,
      done: Promise.resolve(),
      initialModeId: runtime?.mode,
      yolo: runtime?.yolo,
      modelOverlay: runtime?.modelOverlay,
      engineEnv: runtime?.engineEnv,
      mcpServers: runtime?.mcpServers ?? [],
    };
  }

  /**
   * Shared runner: resolves the engine, opens the ACP connection, calls
   * `connect` to create-or-load the session (which also stashes
   * modes/configOptions/controls on `session`), then drives the prompt queue.
   * Every exit path falls through to terminateSession so a dead session is
   * always evicted with a terminal SSE event instead of being retained.
   */
  private spawnRunner(
    session: ManagedSession,
    connect: (ctx: ClientContext) => Promise<SessionHandle>,
  ): void {
    const sessionId = session.sessionId;
    const run = (async () => {
      let runError: string | undefined;
      const resolved = await getEngine(session.engine)
        .resolve()
        .then((r) => ({ ok: true as const, resolved: r }))
        .catch((err: Error) => ({ ok: false as const, error: err.message }));
      if (!resolved.ok) {
        runError = resolved.error;
        this.setReady(session, { ok: false, error: resolved.error });
      } else {
        const env = {
          ...buildEngineEnv(
            session.engine,
            mergeModelOverlay(this.overlay, session.modelOverlay),
          ),
          ...resolved.resolved.envOverlay,
          ...session.engineEnv,
        };

        await withEngineConnection(
          {
            command: resolved.resolved.command,
            args: resolved.resolved.args,
            env,
            cwd: session.cwd,
          },
          {
            permissionMode: this.permissionMode,
            coordinator: this.coordinator,
            appSessionId: sessionId,
            onPermissionAsk: (request, meta) =>
              this.askPermission(sessionId, request, meta),
            onAgentText: () => {},
            onRawUpdate: (notification: SessionNotification) => {
              this.broadcast(sessionId, "agent_session_update", {
                sessionId,
                acpSessionId: notification.sessionId,
                messageType: "agentSessionUpdate",
                subType: notification.update.sessionUpdate,
                data: notification.update,
                timestamp: new Date().toISOString(),
              });
            },
          },
          async (ctx) => {
            const handle = await connect(ctx);
            this.setReady(session, { ok: true });

            // Apply downstream model overlay via ACP configOption so the engine
            // uses the model the cloud sent, not the local config.toml default.
            if (
              session.modelOverlay?.model &&
              session.configOptions &&
              session.engine === "codex"
            ) {
              const modelOption = session.configOptions.find(
                (o) =>
                  (o as { category?: string }).category === "model" ||
                  (o as { category?: string }).category === "model_config",
              );
              if (modelOption) {
                const optionId = (modelOption as { id?: string }).id;
                if (optionId) {
                  try {
                    const next = await ctx.request(
                      AGENT_METHODS.session_set_config_option,
                      {
                        sessionId: handle.sessionId,
                        configId: optionId,
                        value: session.modelOverlay.model,
                      },
                    );
                    session.configOptions =
                      (next as { configOptions?: SessionConfigOption[] })
                        .configOptions ?? session.configOptions;
                    debugLog("serve.chat", "model overlay applied", {
                      sessionId,
                      model: session.modelOverlay.model,
                      configId: optionId,
                    });
                  } catch (err) {
                    debugLog("serve.chat", "model overlay failed", {
                      sessionId,
                      error: (err as Error).message,
                    });
                  }
                }
              }
            }

            const appliedMode = await applySessionMode(
              ctx,
              { sessionId: handle.sessionId, modes: session.modes },
              session.initialModeId,
              Boolean(session.yolo),
            );
            // SetSessionModeResponse carries no new state, so mirror the
            // applied mode locally — otherwise the UI controls and /api/live
            // would report the stale initial mode (e.g. "default" while the
            // engine is actually in bypassPermissions under --yolo).
            if (appliedMode && session.modes) {
              session.modes = { ...session.modes, currentModeId: appliedMode };
            }
            this.broadcastState(sessionId);

            while (true) {
              const prompt = await session.queue.next();
              if (prompt === undefined) break; // queue closed -> stop this session
              this.broadcast(sessionId, "session_prompt_start", {
                sessionId,
                acpSessionId: handle.sessionId,
                messageType: "sessionPromptStart",
                subType: "start",
                data: { prompt },
                timestamp: new Date().toISOString(),
              });
              try {
                const result = await handle.prompt(prompt);
                this.broadcast(sessionId, "end_turn", {
                  sessionId,
                  acpSessionId: handle.sessionId,
                  messageType: "sessionPromptEnd",
                  subType: "end_turn",
                  data: result,
                  timestamp: new Date().toISOString(),
                });
              } catch (err) {
                this.broadcast(sessionId, "end_turn", {
                  sessionId,
                  acpSessionId: handle.sessionId,
                  messageType: "sessionPromptEnd",
                  subType: "error",
                  data: { error: (err as Error).message },
                  timestamp: new Date().toISOString(),
                });
              }
            }
            // Best-effort — not every engine implements session/close.
            await ctx
              .request(AGENT_METHODS.session_close, {
                sessionId: handle.sessionId,
              })
              .catch(() => {});
          },
          session.abortController.signal,
        ).catch((err: Error) => {
          // ok:false here is a no-op if the engine already connected (ready
          // resolved ok:true) — terminateSession below is what actually evicts
          // the now-dead session in that case.
          runError = err.message;
          this.setReady(session, { ok: false, error: err.message });
        });
      }
      this.terminateSession(sessionId, runError);
    })();

    session.done = run;
  }

  /** 当前所有会话 + loose 挂着的 SSE 客户端总数。 */
  countSseClients(): number {
    let n = this.looseSseClients.size;
    for (const session of this.sessions.values()) n += session.sseClients.size;
    return n;
  }

  /**
   * 挂一个不绑定引擎会话的 SSE，仅用于接收 acpRequestPermission。
   * 生产上云端应订阅 /computer/progress/:sessionId；本方法供测试与无会话审批通道。
   */
  subscribeLooseSse(res: ServerResponse): void {
    this.looseSseClients.add(res);
    res.on("close", () => this.looseSseClients.delete(res));
  }

  private deliverPermissionSse(message: UnifiedSessionMessage): number {
    let delivered = 0;
    const write = (client: ServerResponse) => {
      sendSseEvent(client, "acpRequestPermission", message);
      sendSseEvent(client, "acp_request_permission", message);
      delivered++;
    };
    for (const client of this.looseSseClients) write(client);
    for (const session of this.sessions.values()) {
      for (const client of session.sseClients) write(client);
    }
    return delivered;
  }

  /** 向所有活动会话的 SSE 客户端广播（合成敏感访问无单一 session 时用）。 */
  broadcastPermissionToAll(message: UnifiedSessionMessage): number {
    return this.deliverPermissionSse(message);
  }

  /**
   * 挂起 ACP permission：创建 pending，经 SSE 推送，等待 notify-resolved。
   * 若当前没有任何 SSE 订阅者，立即 cancelled，避免干等 120s。
   */
  async askPermission(
    appSessionId: string,
    request: RequestPermissionRequest,
    meta?: { classifierId?: string; reason?: string },
  ): Promise<RequestPermissionResponse> {
    if (this.countSseClients() === 0) {
      return { outcome: { outcome: "cancelled" } };
    }

    const { interventionId, promise, pending } = this.pending.createPending({
      appSessionId,
      acpSessionId: request.sessionId,
      request,
      classifierId: meta?.classifierId,
    });

    const message: UnifiedSessionMessage = {
      sessionId: appSessionId,
      acpSessionId: request.sessionId,
      messageType: "acpRequestPermission",
      subType: "request_permission",
      data: toComputerPermissionProgressData({
        request,
        interventionId,
        revision: 1,
      }),
      timestamp: new Date().toISOString(),
    };

    const session = this.sessions.get(appSessionId);
    if (session && session.sseClients.size > 0) {
      for (const client of session.sseClients) {
        sendSseEvent(client, "acpRequestPermission", message);
        sendSseEvent(client, "acp_request_permission", message);
      }
      for (const client of this.looseSseClients) {
        sendSseEvent(client, "acpRequestPermission", message);
        sendSseEvent(client, "acp_request_permission", message);
      }
    } else {
      this.broadcastPermissionToAll(message);
    }

    const response = await promise;

    // allow_always → 缓存该敏感分类，本会话后续不再弹
    if (response.outcome.outcome === "selected" && pending.classifierId) {
      const optionId = response.outcome.optionId;
      const option = request.options.find((o) => o.optionId === optionId);
      if (option?.kind === "allow_always") {
        this.coordinator.rememberAllowAlways(
          appSessionId,
          pending.classifierId,
        );
      }
    }

    return response;
  }

  /**
   * CLI/HTTP 旁路：合成 permission，走同一 pending + SSE，返回是否放行。
   * 无审批通道（无 SSE）时立刻返回 allowed:false，并带上 noApprovalChannel。
   */
  async awaitSensitiveAccess(args: {
    kind: string;
    title: string;
    rawInput?: Record<string, unknown>;
    appSessionId?: string;
  }): Promise<{
    allowed: boolean;
    response: RequestPermissionResponse;
    noApprovalChannel?: boolean;
  }> {
    const appSessionId =
      args.appSessionId ??
      this.sessions.keys().next().value ??
      `sensitive-${crypto.randomUUID()}`;
    const acpSessionId = `synth-${crypto.randomUUID()}`;
    const request = buildSyntheticPermissionRequest({
      acpSessionId,
      title: args.title,
      kind: "read",
      rawInput: {
        sensitive_kind: args.kind,
        ...(args.rawInput ?? {}),
      },
    });

    const decision = this.coordinator.evaluate(
      request,
      this.permissionMode === "deny-noninteractive"
        ? "deny"
        : this.permissionMode === "ask"
          ? "ask"
          : "yolo",
      appSessionId,
    );
    const immediate = this.coordinator.toImmediateResponse(decision);
    if (immediate) {
      return {
        allowed: responseAllowsAccess(immediate, request),
        response: immediate,
      };
    }

    if (this.countSseClients() === 0) {
      return {
        allowed: false,
        noApprovalChannel: true,
        response: { outcome: { outcome: "cancelled" } },
      };
    }

    const response = await this.askPermission(appSessionId, request, {
      classifierId:
        decision.kind === "ask" ? decision.classifierId : args.kind,
      reason: decision.kind === "ask" ? decision.reason : "sensitive",
    });
    return { allowed: responseAllowsAccess(response, request), response };
  }

  /** Starts a brand-new session and returns its id immediately; the engine connects in the background. */
  startSession(
    engineId: EngineKind,
    cwd: string,
    metadata?: { userId?: string; projectId?: string },
    runtime?: SessionRuntimeOptions,
  ): ManagedSession {
    const session = this.createManagedSession(engineId, cwd, metadata, runtime);
    this.sessions.set(session.sessionId, session);
    this.spawnRunner(session, async (ctx) => {
      // Read modes/configOptions off the raw ActiveSession before wrapping —
      // SessionHandle only exposes sessionId/modes/prompt.
      const built = await ctx
        .buildSession({ cwd, mcpServers: session.mcpServers })
        .start();
      session.acpSessionId = built.sessionId;
      session.modes = built.modes;
      session.configOptions = built.newSessionResponse.configOptions ?? null;
      session.controls = this.buildControls(ctx, built.sessionId);
      return wrapNewSession(built);
    });
    return session;
  }

  /**
   * Resumes an existing local session via ACP `session/load`. The session's
   * original `cwd` is mandatory and overrides any caller-supplied cwd —
   * `session/load` correctness depends on it (mirrors `chat --resume`).
   */
  resumeSession(
    engineId: EngineKind,
    summary: LocalSessionSummary,
    metadata?: { userId?: string; projectId?: string },
    runtime?: SessionRuntimeOptions,
  ): ManagedSession {
    const session = this.createManagedSession(
      engineId,
      summary.cwd,
      metadata,
      runtime,
    );
    this.sessions.set(session.sessionId, session);
    this.spawnRunner(session, async (ctx) => {
      const loadRes = (await ctx.request(AGENT_METHODS.session_load, {
        sessionId: summary.sessionId,
        cwd: summary.cwd,
        mcpServers: session.mcpServers,
      })) as {
        modes?: SessionModeState | null;
        configOptions?: SessionConfigOption[] | null;
      };
      session.acpSessionId = summary.sessionId;
      session.modes = loadRes.modes ?? null;
      session.configOptions = loadRes.configOptions ?? null;
      session.controls = this.buildControls(ctx, summary.sessionId);
      return wrapResumedSession(ctx, summary.sessionId, loadRes.modes);
    });
    return session;
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Switches the engine session mode; optimistically updates local state. */
  async setMode(sessionId: string, modeId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session?.controls) return false;
    const readiness = await session.ready;
    if (!readiness.ok) return false;
    try {
      await session.controls.setMode(modeId);
      if (session.modes) {
        // SetSessionModeResponse carries no new state, so update locally.
        session.modes = { ...session.modes, currentModeId: modeId };
      }
      this.broadcastState(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  /** Switches a config option (e.g. model); replaces state from the response. */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session?.controls) return false;
    const readiness = await session.ready;
    if (!readiness.ok) return false;
    try {
      const next = await session.controls.setConfigOption(configId, value);
      // Only adopt the response if it actually carries the option set; a
      // non-compliant engine returning no/empty configOptions would otherwise
      // wipe the controls (incl. the model selector) from the UI.
      if (next.length > 0) session.configOptions = next;
      this.broadcastState(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  getSessionInfo(
    sessionId: string,
  ):
    | {
        sessionId: string;
        engine: EngineKind;
        cwd: string;
        acpSessionId?: string;
        modes: SessionModeState | null | undefined;
        configOptions: SessionConfigOption[] | null | undefined;
        model: string | undefined;
        ready: boolean;
      }
    | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      sessionId: session.sessionId,
      engine: session.engine,
      cwd: session.cwd,
      acpSessionId: session.acpSessionId,
      modes: session.modes,
      configOptions: session.configOptions,
      model: modelFromConfigOptions(session.configOptions),
      ready: session.readyOk === true,
    };
  }

  findSessionByProjectId(projectId: string): ManagedSession | undefined {
    return [...this.sessions.values()].find((s) => s.projectId === projectId);
  }

  enqueuePrompt(sessionId: string, text: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.queue.push(text);
    return true;
  }

  subscribeSse(sessionId: string, res: ServerResponse): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.sseClients.add(res);
    res.on("close", () => session.sseClients.delete(res));
    return true;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.queue.close();
    this.pending.cancelByAppSession(sessionId);
    this.coordinator.clearSession(sessionId);
    // Interrupt any in-flight prompt by killing the engine. Without this the
    // runner stays parked on `await active.prompt(...)` until the tool call
    // finishes on its own, so /computer/agent/stop would hang for minutes.
    session.abortController.abort();
    // Hard cap so a misbehaving engine that ignores SIGTERM can't keep the
    // stop call (and thus `serve` shutdown) waiting forever.
    await Promise.race([
      session.done.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    this.terminateSession(sessionId);
    return true;
  }

  /** Stops every active session — used by `serve` shutdown so engine child
   *  processes don't outlive the HTTP server. */
  async stopAll(): Promise<void> {
    this.pending.cancelAll();
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.stopSession(id)));
  }

  /**
   * Evicts the session, broadcasts a terminal event, and closes any attached
   * SSE responses. Idempotent — safe to call from both the runner's end-of-run
   * cleanup and stopSession/stopAll (whichever fires first wins, the other is
   * a no-op).
   */
  private terminateSession(sessionId: string, error?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.pending.cancelByAppSession(sessionId);
    this.coordinator.clearSession(sessionId);
    this.broadcast(sessionId, "session_ended", {
      sessionId,
      messageType: "sessionPromptEnd",
      subType: error ? "error" : "ended",
      data: error ? { error } : { ended: true },
      timestamp: new Date().toISOString(),
    });
    for (const client of session.sseClients) {
      try {
        client.end();
      } catch {
        // already closed
      }
    }
    session.sseClients.clear();
    this.sessions.delete(sessionId);
  }

  listSessions(): Array<{
    sessionId: string;
    engine: EngineKind;
    cwd: string;
    userId?: string;
    projectId?: string;
    acpSessionId?: string;
    modes: SessionModeState | null | undefined;
    configOptions: SessionConfigOption[] | null | undefined;
    model: string | undefined;
    ready: boolean;
  }> {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      engine: s.engine,
      cwd: s.cwd,
      userId: s.userId,
      projectId: s.projectId,
      acpSessionId: s.acpSessionId,
      modes: s.modes,
      configOptions: s.configOptions,
      model: modelFromConfigOptions(s.configOptions),
      ready: s.readyOk === true,
    }));
  }
}
