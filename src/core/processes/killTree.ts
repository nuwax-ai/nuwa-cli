import { spawnSync, type ChildProcess } from "node:child_process";
import { isPidAlive } from "./processRegistry.js";
import { debugLog } from "../debugLog.js";

/**
 * Worst-case budget for a full `terminateProcessTree` pass:
 * naturalExitMs (2s) + termEscalateMs (3s) + killVerifyMs (1s).
 *
 * `stopSession` must wait at least this long (plus margin) before returning,
 * otherwise the host `serve` process can exit while the SIGKILL escalation
 * timers are still pending — re-orphaning the tree (see sessionHub stopSession).
 */
export const ENGINE_TEARDOWN_BUDGET_MS = 6000;

export interface TerminateTreeOptions {
  /** How long to wait for the adapter to exit on its own after stdin EOF. */
  naturalExitMs?: number;
  /** How long to poll the process group after SIGTERM before escalating. */
  termEscalateMs?: number;
  /** How long to verify the group is gone after SIGKILL. */
  killVerifyMs?: number;
}

const POLL_INTERVAL_MS = 100;

/** True while any member of the process group `pgid` is still alive. */
function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForGone(
  isGone: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!isGone() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return isGone();
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  const pid = proc.pid;
  if (pid === undefined || proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve(true);
  }
  return waitForGone(() => !isPidAlive(pid), timeoutMs);
}

function sendGroupSignal(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (err) {
    // ESRCH = group already empty; anything else is worth logging but must
    // never throw — teardown failure must not pollute the caller's error
    // semantics (session eviction is already handled by terminateSession).
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      debugLog("engine.killTree", `group ${signal} failed`, {
        pgid,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Tears down the engine process tree. The adapter is spawned with
 * `detached: true` on POSIX, so its pid is also its process group id — the
 * three-phase sequence below covers the whole tree atomically:
 *
 *  1. stdin EOF  -> triggers the adapter's graceful shutdown path;
 *  2. group SIGTERM (POSIX) / `taskkill /T /F` (Windows) after the natural
 *     exit grace window;
 *  3. group SIGKILL escalation after the SIGTERM grace window, then a short
 *     verification pass.
 *
 * Never throws: a failed teardown is logged via debugLog and the promise
 * still resolves so the session lifecycle stays intact.
 */
export async function terminateProcessTree(
  proc: ChildProcess,
  opts: TerminateTreeOptions = {},
): Promise<void> {
  const { naturalExitMs = 2000, termEscalateMs = 3000, killVerifyMs = 1000 } =
    opts;
  const pid = proc.pid;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return;

  // Phase 1: graceful shutdown via stdin EOF. Idempotent and wrapped so a
  // closed/broken pipe can never abort the teardown.
  try {
    proc.stdin?.end();
  } catch {
    // stdin already closed — fine.
  }

  if (await waitForExit(proc, naturalExitMs)) {
    // The adapter exiting on its own is only a clean teardown if the whole
    // group is gone — the orphaned-grandchild defect (R3) is exactly an
    // adapter that exits while its tree stays alive. On Windows there is no
    // group to probe, so a natural adapter exit is sufficient.
    if (process.platform === "win32" || !processGroupAlive(pid)) return;
  }

  // Phase 2: platform branch. Windows has no POSIX process-group semantics —
  // `taskkill /T /F` walks the tree instead (params match processRegistry.ts).
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    await waitForExit(proc, killVerifyMs);
    return;
  }

  sendGroupSignal(pid, "SIGTERM");
  if (await waitForGone(() => !processGroupAlive(pid), termEscalateMs)) return;

  // Phase 3: escalation. The timer is intentionally *not* unref'd — the host
  // must stay alive until the tree is confirmed dead, otherwise the SIGKILL
  // never lands and the tree re-orphans.
  sendGroupSignal(pid, "SIGKILL");
  if (!(await waitForGone(() => !processGroupAlive(pid), killVerifyMs))) {
    debugLog("engine.killTree", "process group still alive after SIGKILL", {
      pid,
    });
  }
}
