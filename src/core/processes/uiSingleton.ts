import { t } from "../../util/i18n/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  cliUiGuardPath,
  ensureDir,
  writeFileAtomic,
} from "../../util/paths.js";
import {
  getProcessStartToken,
  isPidAlive,
  listRegisteredProcesses,
  stopProcessIds,
  unregisterProcess,
} from "./processRegistry.js";
import { discoverLegacyNuwaProcesses } from "./serveSingleton.js";

interface UiGuard {
  pid: number;
  createdAt: string;
  processStartToken?: string;
}

function readGuard(): UiGuard | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(cliUiGuardPath(), "utf8"),
    ) as Partial<UiGuard>;
    return Number.isInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.createdAt === "string"
      ? (value as UiGuard)
      : null;
  } catch {
    return null;
  }
}

function removeGuard(): void {
  try {
    fs.unlinkSync(cliUiGuardPath());
  } catch {
    // Already absent.
  }
}

function isGuardAlive(guard: UiGuard): boolean {
  if (!isPidAlive(guard.pid)) return false;
  if (!guard.processStartToken) return true;
  const token = getProcessStartToken(guard.pid);
  return !token || token === guard.processStartToken;
}

function claimGuard(pid: number): void {
  ensureDir(path.dirname(cliUiGuardPath()));
  const payload = JSON.stringify(
    {
      pid,
      createdAt: new Date().toISOString(),
      processStartToken: getProcessStartToken(pid),
    },
    null,
    2,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(cliUiGuardPath(), "wx", 0o600);
      try {
        fs.writeFileSync(fd, payload);
      } finally {
        fs.closeSync(fd);
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const owner = readGuard();
      if (owner?.pid === pid) return;
      if (!owner || !isGuardAlive(owner)) {
        removeGuard();
        continue;
      }
      throw new Error(t("singleton.ui.running", { pid: owner.pid }));
    }
  }
  throw new Error(t("singleton.ui.lockFail"));
}

export function findUiProcessIds(excludePid = process.pid): number[] {
  const pids = new Set<number>();
  const guard = readGuard();
  if (guard && isGuardAlive(guard)) pids.add(guard.pid);
  for (const record of listRegisteredProcesses()) {
    if (record.kind === "ui") pids.add(record.pid);
  }
  for (const discovered of discoverLegacyNuwaProcesses()) {
    if (discovered.kind === "ui" && isPidAlive(discovered.pid)) {
      pids.add(discovered.pid);
    }
  }
  pids.delete(excludePid);
  return [...pids].sort((a, b) => a - b);
}

export async function acquireUiSingleton(force: boolean): Promise<number[]> {
  const existing = findUiProcessIds();
  if (existing.length > 0 && !force) {
    throw new Error(
      t("singleton.ui.detected", { pids: existing.join(", ") }),
    );
  }
  if (existing.length > 0) {
    await stopProcessIds(existing);
    const guard = readGuard();
    if (guard && existing.includes(guard.pid)) removeGuard();
  }
  claimGuard(process.pid);
  return existing;
}

export function releaseUiSingleton(pid = process.pid): void {
  const guard = readGuard();
  if (guard?.pid === pid) removeGuard();
  unregisterProcess(pid);
}

export interface RepairUiSingletonResult {
  keptPid?: number;
  stoppedPids: number[];
}

export async function repairUiSingleton(): Promise<RepairUiSingletonResult> {
  const pids = findUiProcessIds();
  if (pids.length <= 1) return { keptPid: pids[0], stoppedPids: [] };
  const registered = listRegisteredProcesses()
    .filter((record) => record.kind === "ui" && pids.includes(record.pid))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const keptPid = registered[0]?.pid ?? pids[pids.length - 1];
  const stoppedPids = pids.filter((pid) => pid !== keptPid);
  await stopProcessIds(stoppedPids);
  const guard = readGuard();
  if (guard && stoppedPids.includes(guard.pid)) removeGuard();
  claimGuard(keptPid);
  return { keptPid, stoppedPids };
}
