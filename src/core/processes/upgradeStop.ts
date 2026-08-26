/**
 * Shared stop-before-install/upgrade helpers.
 *
 * Used by `nuwa-cli update` and the first-time `nuwa-cli install` wizard so
 * both paths tear down Gateway / Console / tunnel orphans the same way
 * (including Windows vendor .exe lock release).
 */
import {
  listRegisteredProcesses,
  stopProcessIds,
} from "./processRegistry.js";
import {
  ensureWindowsUpgradeLocksReleased,
  findServeProcessIds,
  listRunningWindowsUpgradeLockImages,
  stopServeProcesses,
  stopTunnelChildProcesses,
} from "./serveSingleton.js";
import { findUiProcessIds } from "./uiSingleton.js";
import { t } from "../../util/i18n/index.js";

/** Snapshot of runtime PIDs that would block a global npm overlay. */
export interface RunningRuntimeSnapshot {
  gatewayPids: number[];
  consolePids: number[];
  /** Registered lanproxy / file-server children still alive. */
  childPids: number[];
  /** Windows vendor images still holding upgrade locks (empty on non-win32). */
  windowsLockImages: string[];
}

/**
 * Collects live Gateway / Console / registered tunnel children (and Windows
 * lock images). Excludes the current process so an in-flight CLI is not listed.
 */
export function collectRunningRuntimeSnapshot(
  excludePid = process.pid,
): RunningRuntimeSnapshot {
  const gatewayPids = findServeProcessIds(excludePid).filter(
    (pid) => pid !== excludePid,
  );
  const consolePids = findUiProcessIds(excludePid).filter(
    (pid) => pid !== excludePid,
  );
  const childPids = listRegisteredProcesses()
    .filter(
      (r) =>
        (r.kind === "lanproxy" || r.kind === "file-server") &&
        r.pid !== excludePid,
    )
    .map((r) => r.pid);
  const windowsLockImages =
    process.platform === "win32" ? listRunningWindowsUpgradeLockImages() : [];
  return { gatewayPids, consolePids, childPids, windowsLockImages };
}

export function hasRunningRuntimeProcesses(
  snapshot: RunningRuntimeSnapshot = collectRunningRuntimeSnapshot(),
): boolean {
  return (
    snapshot.gatewayPids.length > 0 ||
    snapshot.consolePids.length > 0 ||
    snapshot.childPids.length > 0 ||
    snapshot.windowsLockImages.length > 0
  );
}

/**
 * Stops Gateway / Console / tunnel orphans and releases Windows vendor locks.
 * No-op under Vitest so unit tests do not touch the host process table.
 */
export async function stopRuntimeProcessesForUpdate(): Promise<void> {
  if (process.env.VITEST) return;
  const gatewayPids = findServeProcessIds(0).filter(
    (pid) => pid !== process.pid,
  );
  const consolePids = findUiProcessIds().filter((pid) => pid !== process.pid);

  // stopServeProcesses already includes stopTunnelChildProcesses (plus Windows
  // taskkill for nuwax-codex.exe / nuwax-lanproxy.exe). When there is no
  // gateway, still clear orphans so npm does not hit EBUSY on vendor binaries.
  if (gatewayPids.length > 0) await stopServeProcesses(gatewayPids);
  else await stopTunnelChildProcesses();
  if (consolePids.length > 0) await stopProcessIds(consolePids);

  const stillLocked = await ensureWindowsUpgradeLocksReleased();
  if (stillLocked.length > 0) {
    throw new Error(
      t("update.windowsLocksHeld", { images: stillLocked.join(", ") }),
    );
  }
}
