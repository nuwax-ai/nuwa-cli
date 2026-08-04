import * as http from "node:http";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import APP_HTML from "./appHtml.html";
import { SessionHub } from "../serve/sessionHub.js";
import {
  readJsonBody,
  sendJson,
  httpResult,
  httpError,
  textField,
} from "../serve/httpUtil.js";
import { codexSessionsDir, claudeProjectsDir } from "../env/engineHome.js";
import { listLocalSessions } from "../sessions/discovery.js";
import { parseTranscript } from "../sessions/transcript.js";
import { probeAvailableEngines } from "../engines/probe.js";
import { getEngineModelHint } from "./modelInfo.js";
import type { EngineKind } from "../env/inheritEnv.js";
import type { PermissionMode } from "../permissions/policy.js";

export interface UiServerOptions {
  port: number;
  host: string;
  /** Default engine for the "new session" action. */
  engine: EngineKind;
  cwd: string;
  permissionMode: PermissionMode;
  /** Human-readable approve label for the footer (e.g. "auto · yolo"). */
  policyLabel: string;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function transcriptRoot(engine: EngineKind): string {
  return engine === "claude" ? claudeProjectsDir() : codexSessionsDir();
}

/** Guards the transcript read to files actually under an engine transcript root. */
function isAllowedTranscript(engine: EngineKind, file: string): boolean {
  const root = transcriptRoot(engine);
  const rel = path.relative(root, path.resolve(file));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Starts the local-only UI HTTP server (browser dashboard). Returns the
 * generated ephemeral token (embedded in the served HTML so the user never
 * types it) and a stop() function.
 */
export function startUiHttp(options: UiServerOptions): {
  token: string;
  server: http.Server;
  stop: () => Promise<void>;
} {
  const token = crypto.randomBytes(24).toString("hex");
  const hub = new SessionHub(options.permissionMode, options.overlay);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    // Defense in depth against drive-by / DNS-rebinding: the browser must
    // present the ephemeral token (header or query) AND the Host header must
    // resolve to a loopback address. The token is embedded in the served page,
    // so a cross-origin page can neither read it nor make authenticated calls.
    const headerToken = req.headers["x-nuwax-ui-token"];
    const queryToken = url.searchParams.get("t");
    const authorized =
      (typeof headerToken === "string" && headerToken === token) ||
      (typeof queryToken === "string" && queryToken === token);
    // Use the parsed URL hostname so IPv6 loopback ([::1]:port) is matched
    // correctly — a naive split(":")[0] yields "[" for bracketed hosts.
    const hostName = url.hostname;
    const loopbackHost = LOOPBACK_HOSTS.has(hostName);

    const isHtmlRoot = url.pathname === "/" && method === "GET";
    if (!authorized || !loopbackHost) {
      sendJson(res, 401, httpError("UNAUTHORIZED", "missing or invalid token"));
      return;
    }

    if (isHtmlRoot) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(APP_HTML);
      return;
    }

    // ---- engines ----
    if (url.pathname === "/api/engines" && method === "GET") {
      (async () => {
        const probes = await probeAvailableEngines();
        const engines = probes.map((p) => ({
          id: p.id,
          ok: p.ok,
          detail: p.detail,
          fix: p.fix,
          model: getEngineModelHint(p.id as EngineKind),
        }));
        sendJson(res, 200, { ...httpResult({ engines }), engines, policy: options.policyLabel });
      })().catch((err) =>
        sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
      );
      return;
    }

    // ---- history sessions ----
    if (url.pathname === "/api/sessions" && method === "GET") {
      const engine = url.searchParams.get("engine") as EngineKind | null;
      const search = url.searchParams.get("search") ?? undefined;
      (async () => {
        const sessions = await listLocalSessions({
          engine: engine === "claude" || engine === "codex" ? engine : undefined,
          search,
        });
        sendJson(res, 200, { ...httpResult({ sessions }), sessions });
      })().catch((err) =>
        sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
      );
      return;
    }

    const transcriptMatch = url.pathname.match(
      /^\/api\/sessions\/(claude|codex)\/([^/]+)\/transcript$/,
    );
    if (transcriptMatch && method === "GET") {
      const engine = transcriptMatch[1] as EngineKind;
      const file = url.searchParams.get("file") ?? "";
      if (!file || !isAllowedTranscript(engine, file)) {
        sendJson(res, 400, httpError("VALIDATION_ERROR", "invalid transcript file"));
        return;
      }
      (async () => {
        const result = await parseTranscript(engine, file, { limit: 200 });
        // Spread so `messages`/`hasMore` sit at the top level (the SPA reads
        // r.messages), matching how the other routes alias their payloads.
        sendJson(res, 200, { ...httpResult(result), ...result });
      })().catch((err) =>
        sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
      );
      return;
    }

    // ---- new session ----
    if (url.pathname === "/api/sessions" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const engine = (textField(body, "engine") as EngineKind) ?? options.engine;
          if (engine !== "claude" && engine !== "codex") {
            sendJson(res, 400, httpError("VALIDATION_ERROR", "engine must be claude or codex"));
            return;
          }
          const cwd = textField(body, "cwd") || options.cwd;
          const mode = textField(body, "mode");
          const managed = hub.startSession(
            engine,
            cwd,
            {},
            { mode, yolo: options.permissionMode === "yolo" },
          );
          // Surface engine-start failures here (the SSE channel may have no
          // subscriber yet to receive a session_ready error) — and gate on
          // readiness.ok so we never hand back a 200 for a session that was
          // already evicted by terminateSession before getSessionInfo ran.
          const readiness = await managed.ready;
          if (!readiness.ok) {
            sendJson(res, 502, httpError("ENGINE_START_FAILED", readiness.error));
            return;
          }
          const info = hub.getSessionInfo(managed.sessionId);
          sendJson(res, 200, {
            ...httpResult({ session: info }),
            session: { ...info, __policy: options.policyLabel },
          });
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    // ---- resume session ----
    if (url.pathname === "/api/sessions/resume" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const engine = textField(body, "engine") as EngineKind;
          const sessionId = textField(body, "sessionId");
          const cwd = textField(body, "cwd");
          if ((engine !== "claude" && engine !== "codex") || !sessionId || !cwd) {
            sendJson(res, 400, httpError("VALIDATION_ERROR", "engine, sessionId, cwd are required"));
            return;
          }
          // Resolve the full local summary so session/load gets the exact
          // original cwd (correctness) and the transcript file path.
          const sessions = await listLocalSessions({ engine });
          const summary = sessions.find((s) => s.sessionId === sessionId);
          if (!summary) {
            sendJson(res, 404, httpError("NOT_FOUND", "local session not found"));
            return;
          }
          const mode = textField(body, "mode");
          const managed = hub.resumeSession(
            engine,
            summary,
            {},
            { mode, yolo: options.permissionMode === "yolo" },
          );
          const readiness = await managed.ready;
          if (!readiness.ok) {
            sendJson(res, 502, httpError("ENGINE_START_FAILED", readiness.error));
            return;
          }
          const info = hub.getSessionInfo(managed.sessionId);
          sendJson(res, 200, {
            ...httpResult({ session: info }),
            session: { ...info, __policy: options.policyLabel },
          });
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    // ---- live sessions list ----
    if (url.pathname === "/api/live" && method === "GET") {
      const sessions = hub.listSessions();
      sendJson(res, 200, { ...httpResult({ sessions }), sessions });
      return;
    }

    const liveMatch = url.pathname.match(/^\/api\/live\/([^/]+)\/(.+)$/);
    const liveId = liveMatch?.[1];
    const liveSub = liveMatch?.[2];

    // ---- SSE event stream ----
    if (liveId && liveSub === "events" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      // Push the current state immediately so a late subscriber still renders
      // the controls even if the session_ready/session_state events already fired.
      const info = hub.getSessionInfo(liveId);
      if (info) {
        const snap = {
          sessionId: liveId,
          messageType: "sessionState",
          subType: "state",
          data: {
            modes: info.modes ?? null,
            configOptions: info.configOptions ?? null,
            model: info.model ?? null,
          },
          timestamp: new Date().toISOString(),
        };
        res.write(`event: session_state\ndata: ${JSON.stringify(snap)}\n\n`);
      }
      const attached = hub.subscribeSse(liveId, res);
      const heartbeat = setInterval(() => {
        try {
          res.write(`event: ping\ndata: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);
      res.on("close", () => clearInterval(heartbeat));
      if (!attached) {
        // No such live session — tell the client to give up.
        res.write(
          `event: session_ended\ndata: ${JSON.stringify({
            sessionId: liveId,
            messageType: "sessionPromptEnd",
            subType: "ended",
            data: { ended: true },
            timestamp: new Date().toISOString(),
          })}\n\n`,
        );
        res.end();
      }
      return;
    }

    if (liveId && liveSub) {
      readJsonBody(req)
        .then(async (body) => {
          if (liveSub === "prompt") {
            const prompt = textField(body, "prompt");
            if (!prompt) {
              sendJson(res, 400, httpError("VALIDATION_ERROR", "prompt is required"));
              return;
            }
            const ok = hub.enqueuePrompt(liveId, prompt);
            sendJson(res, ok ? 200 : 404, ok ? httpResult({ ok: true }) : httpError("NOT_FOUND", "session not found"));
            return;
          }
          if (liveSub === "mode") {
            const modeId = textField(body, "modeId");
            if (!modeId) {
              sendJson(res, 400, httpError("VALIDATION_ERROR", "modeId is required"));
              return;
            }
            const ok = await hub.setMode(liveId, modeId);
            sendJson(res, ok ? 200 : 404, ok ? httpResult({ ok: true }) : httpError("NOT_FOUND", "session not ready or not found"));
            return;
          }
          if (liveSub === "config-option") {
            const configId = textField(body, "configId");
            const value = textField(body, "value");
            if (!configId || !value) {
              sendJson(res, 400, httpError("VALIDATION_ERROR", "configId and value are required"));
              return;
            }
            const ok = await hub.setConfigOption(liveId, configId, value);
            sendJson(res, ok ? 200 : 404, ok ? httpResult({ ok: true }) : httpError("NOT_FOUND", "session not ready or not found"));
            return;
          }
          if (liveSub === "stop") {
            const ok = await hub.stopSession(liveId);
            sendJson(res, ok ? 200 : 404, ok ? httpResult({ ok: true }) : httpError("NOT_FOUND", "session not found"));
            return;
          }
          const permMatch = liveSub.match(/^permission\/(.+)$/);
          if (permMatch) {
            const interventionId = decodeURIComponent(permMatch[1]);
            const optionId = textField(body, "optionId");
            // Strict boolean check: Boolean("false") would be true and silently
            // cancel a permission the caller meant to allow.
            const cancelled = body["cancelled"] === true;
            const response: RequestPermissionResponse = optionId
              ? { outcome: { outcome: "selected", optionId } }
              : { outcome: { outcome: "cancelled" } };
            if (cancelled && optionId) {
              sendJson(res, 400, httpError("VALIDATION_ERROR", "optionId and cancelled are mutually exclusive"));
              return;
            }
            const result = hub.pending.resolveByInterventionId(interventionId, response);
            if (result.ok) {
              sendJson(res, 200, httpResult({ ok: true, hostStatus: result.hostStatus }));
            } else {
              sendJson(res, 404, httpError(result.error.code, result.error.message));
            }
            return;
          }
          sendJson(res, 404, httpError("NOT_FOUND", "unknown live route"));
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    sendJson(res, 404, httpError("NOT_FOUND", "not found"));
  });

  const stop = async (): Promise<void> => {
    await hub.stopAll().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  // Surface listen errors (e.g. EADDRINUSE from a TOCTOU port grab after
  // findAvailablePort) instead of letting them throw as uncaught exceptions.
  server.on("error", (err) => {
    console.error(`[nuwa-cli] Console 服务出错：${(err as Error).message}`);
    void stop();
  });

  server.listen(options.port, options.host);

  return { token, server, stop };
}
