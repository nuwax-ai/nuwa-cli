import * as crypto from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  AGENT_METHODS,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { getEngine } from "../engines/registry.js";
import { buildEngineEnv, type EngineKind } from "../env/inheritEnv.js";
import { withEngineConnection } from "../acp/connection.js";
import { wrapNewSession } from "../acp/sessionHandle.js";
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
    | "heartbeat";
  subType: string;
  data: unknown;
  timestamp: string;
}

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
  ready: Promise<{ ok: true } | { ok: false; error: string }>;
  done: Promise<void>;
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
  ): ManagedSession {
    const sessionId = crypto.randomUUID();
    const queue = new AsyncQueue<string>();
    let readyResolve!: (v: { ok: true } | { ok: false; error: string }) => void;
    const ready = new Promise<{ ok: true } | { ok: false; error: string }>(
      (resolve) => {
        readyResolve = resolve;
      },
    );

    const session: ManagedSession = {
      sessionId,
      engine: engineId,
      cwd,
      userId: metadata?.userId,
      projectId: metadata?.projectId,
      queue,
      sseClients: new Set(),
      abortController: new AbortController(),
      ready,
      done: Promise.resolve(),
    };

    const run = (async () => {
      // Whether the engine failed to resolve, died after connecting, was
      // aborted by stopSession, or drained its queue and closed cleanly —
      // every exit path falls through to terminateSession so the session is
      // evicted and its SSE clients get a terminal event instead of the
      // registry silently retaining a dead session forever.
      let runError: string | undefined;
      const resolved = await getEngine(engineId)
        .resolve()
        .then((r) => ({ ok: true as const, resolved: r }))
        .catch((err: Error) => ({ ok: false as const, error: err.message }));
      if (!resolved.ok) {
        runError = resolved.error;
        readyResolve({ ok: false, error: resolved.error });
      } else {
        const env = {
          ...buildEngineEnv(engineId, this.overlay),
          ...resolved.resolved.envOverlay,
        };

        await withEngineConnection(
          {
            command: resolved.resolved.command,
            args: resolved.resolved.args,
            env,
            cwd,
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
            const active = wrapNewSession(await ctx.buildSession(cwd).start());
            readyResolve({ ok: true });

            while (true) {
              const prompt = await queue.next();
              if (prompt === undefined) break; // queue closed -> stop this session
              this.broadcast(sessionId, "session_prompt_start", {
                sessionId,
                acpSessionId: active.sessionId,
                messageType: "sessionPromptStart",
                subType: "start",
                data: { prompt },
                timestamp: new Date().toISOString(),
              });
              try {
                const result = await active.prompt(prompt);
                this.broadcast(sessionId, "end_turn", {
                  sessionId,
                  acpSessionId: active.sessionId,
                  messageType: "sessionPromptEnd",
                  subType: "end_turn",
                  data: result,
                  timestamp: new Date().toISOString(),
                });
              } catch (err) {
                this.broadcast(sessionId, "end_turn", {
                  sessionId,
                  acpSessionId: active.sessionId,
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
                sessionId: active.sessionId,
              })
              .catch(() => {});
          },
          session.abortController.signal,
        ).catch((err: Error) => {
          // ok:false here is a no-op if the engine already connected (ready
          // resolved ok:true) — terminateSession below is what actually evicts
          // the now-dead session in that case.
          runError = err.message;
          readyResolve({ ok: false, error: err.message });
        });
      }
      this.terminateSession(sessionId, runError);
    })();

    session.done = run;
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
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
  }> {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      engine: s.engine,
      cwd: s.cwd,
      userId: s.userId,
      projectId: s.projectId,
    }));
  }
}
