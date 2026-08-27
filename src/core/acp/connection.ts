import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Writable, Readable } from "node:stream";
import {
  client,
  ndJsonStream,
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  type ClientContext,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  buildClientCapabilities,
  classifySessionUpdate,
  normalizeMcpAskToolUpdate,
} from "@nuwax-ai/agent-kit";
import type { PermissionMode } from "../permissions/policy.js";
import { decidePermission } from "../permissions/policy.js";
import type { PermissionCoordinator } from "../permissions/coordinator.js";
import { CLI_VERSION } from "../version.js";
import { debugLog } from "../debugLog.js";
import { terminateProcessTree } from "../processes/killTree.js";

export interface SpawnTarget {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface EngineSessionHandlers {
  onAgentText: (text: string) => void;
  onAgentThought?: (text: string) => void;
  /** Fired for every session/update notification, in addition to the text-specific handlers above — used by `serve` to forward the full update over SSE. */
  onRawUpdate?: (notification: SessionNotification) => void;
  /** Plan-family updates (plan / plan_update / plan_removed) — classified by agent-kit; entries are the full replacement list. */
  onPlanUpdate?: (payload: {
    entries: Array<{ content: string; priority: string; status: string }>;
    removed: boolean;
  }) => void;
  /** Engine-side mode change (e.g. ExitPlanMode approved → back to build/default). */
  onModeChange?: (modeId: string | null) => void;
  permissionMode: PermissionMode;
  /** serve 侧注入：敏感/ask 时走 SSE + notify-resolved。 */
  onPermissionAsk?: (
    request: RequestPermissionRequest,
    meta: { classifierId?: string; reason: string },
  ) => Promise<RequestPermissionResponse>;
  coordinator?: PermissionCoordinator;
  /** Hub 的 app session id，用于 allow_always 缓存键。 */
  appSessionId?: string;
}

const STDERR_BUFFER_LIMIT = 8000;

/** Captures the last N bytes of the engine's stderr for error diagnostics, and
 * also logs each line to debugLog so codex/claude stderr is visible in
 * ~/.nuwa-cli/logs without having to wait for a crash. */
function captureStderr(proc: ChildProcessWithoutNullStreams): () => string {
  let buffer = "";
  let lineBuf = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    buffer += text;
    if (buffer.length > STDERR_BUFFER_LIMIT) {
      buffer = buffer.slice(buffer.length - STDERR_BUFFER_LIMIT);
    }
    // Stream stderr line-by-line to debugLog for live diagnostics.
    lineBuf += text;
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) debugLog("engine.stderr", trimmed);
    }
  });
  return () => buffer;
}

function routeSessionUpdate(
  notification: SessionNotification,
  handlers: EngineSessionHandlers,
): void {
  const update = normalizeMcpAskToolUpdate(
    notification.update as unknown as Record<string, unknown>,
  ) as unknown as SessionNotification["update"];
  const normalizedNotification =
    update === notification.update
      ? notification
      : ({ ...notification, update } as SessionNotification);
  handlers.onRawUpdate?.(normalizedNotification);
  const classified = classifySessionUpdate(
    update as unknown as Record<string, unknown>,
  );
  if (classified.plan && handlers.onPlanUpdate) {
    handlers.onPlanUpdate(classified.plan);
  }
  if (classified.modeChange && handlers.onModeChange) {
    handlers.onModeChange(classified.modeChange.modeId);
  }
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      if (update.content.type === "text")
        handlers.onAgentText(update.content.text);
      break;
    case "agent_thought_chunk":
      if (update.content.type === "text") {
        handlers.onAgentThought?.(update.content.text);
      }
      break;
    default:
      break;
  }
}

/**
 * Spawns an ACP-speaking engine process and runs `op` with a connected
 * `ClientContext`. The connection (and the child process) is torn down when
 * `op` resolves, rejects, or throws — mirroring `ClientApp.connectWith`.
 *
 * If `signal` is provided and aborted, the engine process tree is torn down
 * (stdin EOF → group SIGTERM → group SIGKILL) so a long-running `op` (e.g. an
 * in-flight `session/prompt`) is interrupted instead of having to finish on
 * its own — this is what makes a session cancellable from the outside
 * (`serve` `/computer/agent/stop`).
 */
export async function withEngineConnection<T>(
  target: SpawnTarget,
  handlers: EngineSessionHandlers,
  op: (ctx: ClientContext) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const proc = spawn(target.command, target.args, {
    cwd: target.cwd,
    env: target.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // POSIX: make the adapter the leader of its own process group so the
    // teardown below can signal the whole tree (including grandchildren).
    // Windows has no group semantics and `taskkill /T` would miss a detached
    // tree, so it stays in the host's group (matching serveSingleton's note).
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;

  const getStderrTail = captureStderr(proc);

  const processState: {
    spawnErrorMessage: string | null;
    exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
  } = { spawnErrorMessage: null, exitInfo: null };
  proc.once("error", (err) => {
    processState.spawnErrorMessage = `engine process failed to start: ${err.message}`;
  });
  proc.once("exit", (code, signal) => {
    processState.exitInfo = { code, signal };
  });

  // Single-flight, idempotent tree teardown shared by the abort path and the
  // final cleanup below — both may fire (abort during teardown, or vice
  // versa) and must resolve to the same promise.
  let treeKill: Promise<void> | null = null;
  const startTreeKill = () => {
    if (!treeKill) treeKill = terminateProcessTree(proc);
  };

  // Abort -> tear down the engine tree so a parked `op` (e.g. awaiting
  // session/prompt) stops promptly instead of running until the engine
  // finishes naturally.
  const onAbort = () => {
    startTreeKill();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin),
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
  );

  const app = client({ name: "nuwa-cli" })
    .onRequest(
      CLIENT_METHODS.session_request_permission,
      (reqCtx): Promise<RequestPermissionResponse> =>
        decidePermission(reqCtx.params as RequestPermissionRequest, {
          mode: handlers.permissionMode,
          onAsk: handlers.onPermissionAsk,
          coordinator: handlers.coordinator,
          appSessionId: handlers.appSessionId,
        }),
    )
    .onNotification(CLIENT_METHODS.session_update, (reqCtx) => {
      routeSessionUpdate(reqCtx.params as SessionNotification, handlers);
    });

  const run = app.connectWith(stream, async (ctx) => {
    await ctx.request(AGENT_METHODS.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      // plan: {} opts into plan_update / plan_removed session updates
      // (agent-kit assembler, shared with nuwaclaw).
      clientCapabilities: buildClientCapabilities(),
      clientInfo: { name: "nuwa-cli", version: CLI_VERSION },
    });
    return op(ctx);
  });

  try {
    return await run;
  } catch (err) {
    if (signal?.aborted) throw new Error("engine session aborted");
    if (processState.spawnErrorMessage)
      throw new Error(processState.spawnErrorMessage);
    if (!processState.exitInfo) {
      // The ACP stream may report "connection closed" a tick before the
      // child's own 'exit' event fires (both are consequences of the same
      // process death) — give it a brief grace window so a genuine crash
      // surfaces the exit code + stderr instead of the generic SDK message.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const exitInfo = processState.exitInfo;
    if (exitInfo && exitInfo.code !== 0 && exitInfo.code !== null) {
      throw new Error(
        `engine process exited unexpectedly (code=${exitInfo.code}${exitInfo.signal ? `, signal=${exitInfo.signal}` : ""})\n${getStderrTail()}`,
      );
    }
    throw err;
  } finally {
    startTreeKill();
    await treeKill;
    signal?.removeEventListener("abort", onAbort);
  }
}
