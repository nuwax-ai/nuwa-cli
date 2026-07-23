import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EngineKind } from "../env/inheritEnv.js";
import type { PermissionMode } from "../permissions/policy.js";
import { SessionHub } from "./sessionHub.js";
import { writeServeLock, clearServeLock } from "./serveLock.js";
import {
  readJsonBody,
  sendJson,
  httpResult,
  httpError,
  textField,
} from "./httpUtil.js";
import { parseComputerPermissionResolveRequest } from "../permissions/notifyResolved.js";
import { listLocalSessions } from "../sessions/discovery.js";
import { parseTranscript } from "../sessions/transcript.js";
import { ensureDir } from "../../util/paths.js";
import { debugLog } from "../debugLog.js";
import { parseDownstreamSessionConfig } from "./downstreamConfig.js";

export interface ServeOptions {
  port: number;
  host: string;
  engine: EngineKind;
  cwd: string;
  cwdIsProject?: boolean;
  permissionMode: PermissionMode;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
  acceptedSecrets?: string[];
  allowUnauthenticatedComputerRoutes?: boolean;
}

/** 仅本机回环客户端可无 secret 调 sensitive-access（CLI 闸门）；非 loopback 必须带 secret。 */
function isLoopbackRemote(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.endsWith("/127.0.0.1")
  );
}

function secretCandidates(req: http.IncomingMessage, url: URL): string[] {
  const candidates: string[] = [];
  const headerSecret = req.headers["x-nuwax-internal-secret"];
  if (typeof headerSecret === "string") candidates.push(headerSecret);

  const authorization = req.headers.authorization;
  if (typeof authorization === "string") {
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    candidates.push(bearer ? bearer[1] : authorization);
  }

  for (const key of [
    "apiKey",
    "api_key",
    "token",
    "access_token",
    "x-nuwax-internal-secret",
  ]) {
    const value = url.searchParams.get(key);
    if (value) candidates.push(value);
  }

  return candidates;
}

function chatProjectKey(
  body: Record<string, unknown>,
  ...fallbacks: Array<string | undefined | null>
): string | undefined {
  return (
    textField(body, "project_id", "projectId") ??
    textField(body, "agent_work_dir", "agentWorkDir") ??
    textField(body, "session_id", "sessionId") ??
    fallbacks.find((value) => typeof value === "string" && value.length > 0) ??
    undefined
  );
}

function workspaceSegment(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) return fallback;
  const segment = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return segment || fallback;
}

function resolveExistingDirectory(
  candidate: string,
): { ok: true; cwd: string } | { ok: false; error: string } {
  const cwd = path.resolve(candidate);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return {
      ok: false,
      error: `workspace directory does not exist: ${cwd}`,
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      error: `workspace path is not a directory: ${cwd}`,
    };
  }
  return { ok: true, cwd };
}

function resolveChatCwd(
  body: Record<string, unknown>,
  defaultCwd: string,
  defaultCwdIsProject: boolean,
):
  | { ok: true; cwd: string; projectKey?: string }
  | { ok: false; error: string } {
  const explicitCwd = textField(body, "cwd", "workspace_dir", "workspaceDir");
  const projectKey = chatProjectKey(body);
  if (explicitCwd) {
    const resolved = resolveExistingDirectory(explicitCwd);
    return resolved.ok ? { ...resolved, projectKey } : resolved;
  }

  if (defaultCwdIsProject) {
    const resolved = resolveExistingDirectory(defaultCwd);
    return resolved.ok ? { ...resolved, projectKey } : resolved;
  }

  if (projectKey) {
    const cwd = path.join(
      path.resolve(defaultCwd),
      workspaceSegment(projectKey, "default"),
    );
    ensureDir(cwd);
    return { ok: true, cwd, projectKey };
  }

  const resolved = resolveExistingDirectory(defaultCwd);
  return resolved.ok ? { ...resolved, projectKey } : resolved;
}

/**
 * Starts the local-only HTTP server. Returns the generated internal secret
 * (never persisted — callers must copy it from the printed startup message
 * or the returned value) and a stop() function.
 */
export function startServeHttp(options: ServeOptions): {
  secret: string;
  server: http.Server;
  hub: SessionHub;
  addAcceptedSecret: (secret: string | undefined) => void;
  stop: () => Promise<void>;
} {
  const secret = crypto.randomBytes(24).toString("hex");
  const hub = new SessionHub(options.permissionMode, options.overlay);
  const acceptedSecrets = new Set(
    [secret, ...(options.acceptedSecrets ?? [])].filter(Boolean),
  );
  debugLog("serve.http", "starting", {
    host: options.host,
    port: options.port,
    engine: options.engine,
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    acceptedSecretCount: acceptedSecrets.size,
    allowUnauthenticatedComputerRoutes:
      options.allowUnauthenticatedComputerRoutes === true,
  });

  const server = http.createServer((req, res) => {
    let url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const originalPath = url.pathname;
    if (url.pathname.startsWith("/devcomputer/")) {
      url = new URL(
        url.pathname.replace("/devcomputer/", "/computer/") + url.search,
        `http://${req.headers.host}`,
      );
    }
    const method = req.method?.toUpperCase() ?? "GET";
    debugLog("serve.http", "request", {
      method,
      path: url.pathname,
      originalPath,
      hasInternalSecretHeader:
        typeof req.headers["x-nuwax-internal-secret"] === "string",
      hasAuthorizationHeader: typeof req.headers.authorization === "string",
      queryAuthKeys: ["apiKey", "api_key", "token", "access_token"].filter(
        (key) => url.searchParams.has(key),
      ),
    });

    if (method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        engine: options.engine,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const isProgressRoute =
      url.pathname.startsWith("/computer/progress/") && method === "GET";
    // 本机 CLI 闸门：仅 loopback 可无 secret；secret 不落盘，CLI 靠本机回环调用
    const isSensitiveAwaitRoute =
      url.pathname === "/computer/sensitive-access/await" && method === "POST";
    const allowSensitiveAwaitUnauthed =
      isSensitiveAwaitRoute && isLoopbackRemote(req);
    const isComputerRoute = url.pathname.startsWith("/computer/");
    const allowElectronCompatibleComputerRoute =
      options.allowUnauthenticatedComputerRoutes === true && isComputerRoute;
    const authorized = secretCandidates(req, url).some((candidate) =>
      acceptedSecrets.has(candidate),
    );
    if (
      !authorized &&
      !isProgressRoute &&
      !allowSensitiveAwaitUnauthed &&
      !allowElectronCompatibleComputerRoute
    ) {
      debugLog("serve.http", "unauthorized", {
        method,
        path: url.pathname,
      });
      sendJson(res, 401, {
        ...httpError("UNAUTHORIZED", "missing or invalid internal secret"),
        error: "missing or invalid internal secret",
      });
      return;
    }

    if (url.pathname === "/computer/chat" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const prompt = textField(body, "prompt", "message", "content");
          if (!prompt) {
            sendJson(
              res,
              400,
              httpError("VALIDATION_ERROR", "prompt is required"),
            );
            return;
          }
          const existingId = textField(body, "session_id", "sessionId");
          const userId = textField(body, "user_id", "userId");
          const projectId = textField(body, "project_id", "projectId");
          const cwdResult = resolveChatCwd(
            body,
            options.cwd,
            options.cwdIsProject === true,
          );
          if (!cwdResult.ok) {
            debugLog("serve.chat", "cwd resolution failed", {
              userId,
              projectId,
              agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
              error: cwdResult.error,
            });
            sendJson(res, 400, httpError("VALIDATION_ERROR", cwdResult.error));
            return;
          }
          debugLog("serve.chat", "received", {
            userId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            existingId,
            projectKey: cwdResult.projectKey,
            cwd: cwdResult.cwd,
            promptLength: prompt.length,
            hasExplicitCwd: Boolean(
              textField(body, "cwd", "workspace_dir", "workspaceDir"),
            ),
          });

          const session = existingId ? hub.getSession(existingId) : undefined;
          if (existingId && !session) {
            debugLog("serve.chat", "session not found", { existingId });
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                `session ${existingId} not found`,
              ),
            );
            return;
          }
          const downstream = session
            ? undefined
            : parseDownstreamSessionConfig(body);
          debugLog("serve.chat", "runtime config resolved", {
            existingId,
            engine: session?.engine ?? downstream?.engine,
            hasModelOverlay: Boolean(downstream?.modelOverlay),
            hasEngineEnv: Boolean(
              downstream?.engineEnv &&
                Object.keys(downstream.engineEnv).length > 0,
            ),
            mcpServerCount: downstream?.mcpServers.length ?? 0,
          });
          const target =
            session ??
            hub.startSession(
              downstream?.engine ?? "codex",
              cwdResult.cwd,
              {
                userId,
                projectId: cwdResult.projectKey ?? projectId,
              },
              downstream,
            );

          // Wait for the engine to actually connect before responding — if
          // resolve()/session/new fails, surface it here instead of handing
          // back a session_id for a session nothing will ever drive forward
          // (the SSE side has no subscriber yet to receive an error event).
          const readiness = await target.ready;
          if (!readiness.ok) {
            await hub.stopSession(target.sessionId);
            debugLog("serve.chat", "engine start failed", {
              sessionId: target.sessionId,
              error: readiness.error,
            });
            sendJson(
              res,
              502,
              httpError("ENGINE_START_FAILED", readiness.error),
            );
            return;
          }

          hub.enqueuePrompt(target.sessionId, prompt);
          debugLog("serve.chat", "accepted", {
            sessionId: target.sessionId,
            isNewSession: !session,
            projectKey: cwdResult.projectKey,
          });
          const payload = {
            session_id: target.sessionId,
            is_new_session: !session,
            request_id: textField(body, "request_id", "requestId"),
            user_id: userId,
            project_id: projectId,
          };
          sendJson(res, 202, {
            ...httpResult(payload),
            session_id: target.sessionId,
          });
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname.startsWith("/computer/progress/") && method === "GET") {
      const sessionId = url.pathname.replace("/computer/progress/", "");
      debugLog("serve.progress", "connect", {
        sessionId,
        authorized,
      });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("\n");
      if (!hub.subscribeSse(sessionId, res)) {
        debugLog("serve.progress", "session not found; sent idle end", {
          sessionId,
        });
        const message = {
          sessionId,
          messageType: "sessionPromptEnd",
          subType: "end_turn",
          data: {
            reason: "EndTurn",
            description: "Agent has no task in progress",
          },
          timestamp: new Date().toISOString(),
        };
        res.write(`event: end_turn\ndata: ${JSON.stringify(message)}\n\n`);
        res.end();
        return;
      }
      const heartbeat = setInterval(() => {
        const message = {
          sessionId,
          messageType: "heartbeat",
          subType: "ping",
          data: { type: "heartbeat", message: "keep-alive" },
          timestamp: new Date().toISOString(),
        };
        try {
          res.write(`event: ping\ndata: ${JSON.stringify(message)}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);
      res.on("close", () => clearInterval(heartbeat));
      return;
    }

    if (url.pathname === "/computer/agent/status" && method === "GET") {
      // Project to the long-standing status shape — listSessions() now also
      // carries modes/configOptions/model/acpSessionId for the local UI, but
      // those (acpSessionId in particular) aren't part of this cloud-facing
      // contract and shouldn't leak here.
      const sessions = hub.listSessions().map((s) => ({
        sessionId: s.sessionId,
        engine: s.engine,
        cwd: s.cwd,
        userId: s.userId,
        projectId: s.projectId,
      }));
      debugLog("serve.status", "list", { count: sessions.length });
      sendJson(res, 200, { ...httpResult({ sessions }), sessions });
      return;
    }

    if (url.pathname === "/computer/agent/status" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const projectId = textField(body, "project_id", "projectId");
          const sessionId = textField(body, "session_id", "sessionId");
          const projectKey = chatProjectKey(body, projectId);
          debugLog("serve.status", "query", {
            sessionId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            projectKey,
          });
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          sendJson(
            res,
            200,
            httpResult({
              user_id: textField(body, "user_id", "userId"),
              project_id: projectId,
              is_alive: Boolean(session),
              session_id: session?.sessionId ?? null,
              status: session ? "Busy" : null,
              last_activity: null,
              created_at: null,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname === "/computer/agent/stop" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const sessionId = textField(body, "session_id", "sessionId");
          const projectId = textField(body, "project_id", "projectId");
          const projectKey = chatProjectKey(body, projectId);
          debugLog("serve.stop", "request", {
            sessionId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            projectKey,
          });
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          if (!session) {
            debugLog("serve.stop", "session not found", {
              sessionId,
              projectKey,
            });
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                sessionId || projectKey
                  ? `session ${sessionId ?? projectKey} not found`
                  : "session_id, agent_work_dir or project_id is required",
              ),
            );
            return;
          }
          await hub.stopSession(session.sessionId);
          sendJson(
            res,
            200,
            httpResult({
              success: true,
              message: "Agent stopped successfully",
              session_id: session.sessionId,
              project_id: projectId,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (
      url.pathname === "/computer/agent/session/cancel" &&
      method === "POST"
    ) {
      readJsonBody(req)
        .then(async (body) => {
          const sessionId =
            textField(body, "session_id", "sessionId") ??
            url.searchParams.get("session_id") ??
            undefined;
          const projectId =
            textField(body, "project_id", "projectId") ??
            url.searchParams.get("project_id") ??
            undefined;
          const agentWorkDir =
            textField(body, "agent_work_dir", "agentWorkDir") ??
            url.searchParams.get("agent_work_dir") ??
            undefined;
          const projectKey = agentWorkDir ?? projectId;
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          if (session) await hub.stopSession(session.sessionId);
          debugLog("serve.cancel", "request", {
            sessionId,
            projectId,
            agentWorkDir,
            projectKey,
            found: Boolean(session),
          });
          sendJson(
            res,
            200,
            httpResult({
              success: true,
              session_id: session?.sessionId ?? sessionId,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname === "/computer/notify-resolved" && method === "POST") {
      readJsonBody(req)
        .then((body) => {
          const parsed = parseComputerPermissionResolveRequest(body);
          if (!parsed.ok) {
            // 无 permission_resolve_request：保持向后兼容，当作 ignored no-op
            if (parsed.body.error.code === "ERR_NOT_PERMISSION_RESOLVE") {
              sendJson(
                res,
                200,
                httpResult({ success: true, ignored: true }),
              );
              return;
            }
            sendJson(res, parsed.status, {
              ...httpError(parsed.body.error.code, parsed.body.error.message),
              ...parsed.body,
            });
            return;
          }

          const result = hub.pending.resolveBySessionTool(
            parsed.command.acpSessionId,
            parsed.command.toolCallId,
            parsed.command.acpResponse,
          );
          if (!result.ok) {
            const status =
              result.hostStatus === "gone"
                ? 404
                : result.error.code === "ERR_VALIDATION"
                  ? 400
                  : 409;
            sendJson(res, status, {
              ...httpError(result.error.code, result.error.message),
              ok: false,
              hostStatus: result.hostStatus,
              error: result.error,
            });
            return;
          }

          // allow_always：若 pending 带 classifierId，缓存到 coordinator
          if (
            parsed.command.acpResponse.outcome.outcome === "selected" &&
            result.pending.classifierId
          ) {
            const optionId = parsed.command.acpResponse.outcome.optionId;
            const option = result.pending.request.options.find(
              (o) => o.optionId === optionId,
            );
            if (option?.kind === "allow_always") {
              hub.coordinator.rememberAllowAlways(
                result.pending.appSessionId,
                result.pending.classifierId,
              );
            }
          }

          debugLog("serve.notify-resolved", "resolved", {
            acpSessionId: parsed.command.acpSessionId,
            toolCallId: parsed.command.toolCallId,
            hostStatus: result.hostStatus,
          });
          sendJson(
            res,
            200,
            httpResult({
              success: true,
              ok: true,
              hostStatus: result.hostStatus,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    // CLI 旁路：阻塞等待敏感访问审批（与 ACP ask 同构 SSE）
    if (
      url.pathname === "/computer/sensitive-access/await" &&
      method === "POST"
    ) {
      readJsonBody(req)
        .then(async (body) => {
          const kind =
            textField(body, "kind") ?? textField(body, "sensitive_kind");
          if (!kind) {
            sendJson(
              res,
              400,
              httpError("VALIDATION_ERROR", "kind is required"),
            );
            return;
          }
          const title =
            textField(body, "title") ?? `local_sessions_${kind}`;
          const result = await hub.awaitSensitiveAccess({
            kind,
            title,
            rawInput:
              body.raw_input && typeof body.raw_input === "object"
                ? (body.raw_input as Record<string, unknown>)
                : { kind },
            appSessionId: textField(body, "session_id", "sessionId"),
          });
          if (result.noApprovalChannel) {
            sendJson(
              res,
              503,
              httpError(
                "NO_APPROVAL_CHANNEL",
                "no SSE subscriber on /computer/progress — open a cloud/local progress stream before requesting sensitive access",
              ),
            );
            return;
          }
          if (!result.allowed) {
            sendJson(
              res,
              403,
              httpError(
                "CONSENT_DENIED",
                "user denied or cancelled sensitive access",
              ),
            );
            return;
          }
          sendJson(res, 200, httpResult({ allowed: true, kind }));
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    // 敏感导出：列出本地 claude/codex sessions（须先审批）
    if (
      url.pathname === "/computer/local-sessions/list" &&
      (method === "GET" || method === "POST")
    ) {
      const run = async () => {
        const body = method === "POST" ? await readJsonBody(req) : {};
        const engineRaw =
          textField(body, "engine") ?? url.searchParams.get("engine") ?? undefined;
        const engine =
          engineRaw === "claude" || engineRaw === "codex"
            ? engineRaw
            : undefined;
        const consent = await hub.awaitSensitiveAccess({
          kind: "session-history",
          title: "local_sessions_list",
          rawInput: {
            command: `nuwa-cli context list${engine ? ` --engine ${engine}` : ""}`,
          },
          appSessionId: textField(body, "session_id", "sessionId"),
        });
        if (consent.noApprovalChannel) {
          sendJson(
            res,
            503,
            httpError(
              "NO_APPROVAL_CHANNEL",
              "no SSE subscriber on /computer/progress — open a progress stream before listing local sessions",
            ),
          );
          return;
        }
        if (!consent.allowed) {
          sendJson(
            res,
            403,
            httpError("CONSENT_DENIED", "user denied local sessions list"),
          );
          return;
        }
        const sessions = await listLocalSessions(engine);
        sendJson(res, 200, httpResult({ items: sessions }));
      };
      run().catch((err) =>
        sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
      );
      return;
    }

    // 敏感导出：读取单个本地 session transcript
    if (url.pathname === "/computer/local-sessions/read" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const engineRaw = textField(body, "engine");
          const sessionId = textField(body, "session_id", "sessionId");
          if (engineRaw !== "claude" && engineRaw !== "codex") {
            sendJson(
              res,
              400,
              httpError("VALIDATION_ERROR", "engine must be claude or codex"),
            );
            return;
          }
          if (!sessionId) {
            sendJson(
              res,
              400,
              httpError("VALIDATION_ERROR", "session_id is required"),
            );
            return;
          }
          const consent = await hub.awaitSensitiveAccess({
            kind: "session-history",
            title: "local_sessions_read",
            rawInput: {
              command: `nuwa-cli context read --ref ${engineRaw}:${sessionId}`,
            },
            appSessionId: textField(body, "app_session_id", "appSessionId"),
          });
          if (consent.noApprovalChannel) {
            sendJson(
              res,
              503,
              httpError(
                "NO_APPROVAL_CHANNEL",
                "no SSE subscriber on /computer/progress — open a progress stream before reading local sessions",
              ),
            );
            return;
          }
          if (!consent.allowed) {
            sendJson(
              res,
              403,
              httpError("CONSENT_DENIED", "user denied local session read"),
            );
            return;
          }
          const sessions = await listLocalSessions(engineRaw);
          const match = sessions.find((s) => s.sessionId === sessionId);
          if (!match) {
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                `local session ${sessionId} not found`,
              ),
            );
            return;
          }
          const limitRaw = body.limit;
          const limit =
            typeof limitRaw === "number"
              ? limitRaw
              : typeof limitRaw === "string"
                ? Number(limitRaw)
                : undefined;
          const { messages, hasMore } = await parseTranscript(
            engineRaw,
            match.filePath,
            {
              limit:
                Number.isFinite(limit) && (limit as number) > 0
                  ? (limit as number)
                  : undefined,
            },
          );
          sendJson(
            res,
            200,
            httpResult({
              engine: engineRaw,
              sessionId: match.sessionId,
              cwd: match.cwd,
              title: match.title,
              messages,
              hasMore,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    sendJson(res, 404, httpError("NOT_FOUND", "not found"));
  });

  const stop = async (): Promise<void> => {
    debugLog("serve.http", "stopping");
    await hub.stopAll().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearServeLock(process.pid);
    debugLog("serve.http", "stopped");
  };

  server.on("error", (err) => {
    console.error(`[nuwa-cli] Serve server error: ${(err as Error).message}`);
    void stop();
  });

  server.listen(options.port, options.host);

  // Write a pid/port/host lock on listen so `status` can report a running
  // serve without persisting the secret (which stays ephemeral). Cleared in
  // stop(); a crash leaves a stale lock that getServeStatus() auto-cleans.
  server.once("listening", () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : options.port;
    debugLog("serve.http", "listening", {
      host: options.host,
      port: actualPort,
    });
    writeServeLock({
      pid: process.pid,
      port: actualPort,
      host: options.host,
      startedAt: new Date().toISOString(),
    });
  });

  return {
    secret,
    server,
    hub,
    addAcceptedSecret: (value) => {
      if (!value) return;
      acceptedSecrets.add(value);
      debugLog("serve.http", "accepted secret added", {
        acceptedSecretCount: acceptedSecrets.size,
      });
    },
    stop,
  };
}
