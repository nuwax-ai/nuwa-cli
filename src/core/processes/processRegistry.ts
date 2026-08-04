import { t } from "../../util/i18n/index.js";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { cliProcessesDir, writeFileAtomic } from "../../util/paths.js";
import { debugLog } from "../debugLog.js";

export type NuwaProcessKind = "serve" | "ui" | "chat" | "lanproxy" | "file-server";
export type NuwaProcessState = "starting" | "running";

export interface NuwaProcessRecord {
  version: 1;
  pid: number;
  kind: NuwaProcessKind;
  state: NuwaProcessState;
  daemon: boolean;
  startedAt: string;
  cwd: string;
  engine?: string;
  host?: string;
  port?: number;
  logPath?: string;
  processStartToken?: string;
}

export type RegisterProcessInput = Omit<
  NuwaProcessRecord,
  "version" | "startedAt" | "processStartToken"
> & {
  startedAt?: string;
};

function recordPath(pid: number): string {
  return path.join(cliProcessesDir(), `${pid}.json`);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Returns an OS process-start identity where the platform exposes one. It is
 * used to reject a stale record when the OS has already reused the same PID.
 */
export function getProcessStartToken(pid: number): string | undefined {
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fieldsAfterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      // /proc/<pid>/stat field 22; this array begins at field 3.
      const startTicks = fieldsAfterCommand[19];
      return startTicks ? `linux:${startTicks}` : undefined;
    }

    if (process.platform === "darwin") {
      const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        timeout: 1000,
      });
      const value = result.status === 0 ? result.stdout.trim() : "";
      return value ? `darwin:${value}` : undefined;
    }

    if (process.platform === "win32") {
      const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CreationDate.ToUniversalTime().ToString('o')`;
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        {
          encoding: "utf8",
          timeout: 1500,
          windowsHide: true,
        },
      );
      const value = result.status === 0 ? result.stdout.trim() : "";
      return value ? `win32:${value}` : undefined;
    }
  } catch {
    // PID liveness still provides a useful fallback on unsupported systems.
  }
  return undefined;
}

function isRecord(value: unknown): value is NuwaProcessRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NuwaProcessRecord>;
  return (
    item.version === 1 &&
    Number.isInteger(item.pid) &&
    (item.pid ?? 0) > 0 &&
    ["serve", "ui", "chat", "lanproxy", "file-server"].includes(item.kind ?? "") &&
    ["starting", "running"].includes(item.state ?? "") &&
    typeof item.daemon === "boolean" &&
    typeof item.startedAt === "string" &&
    typeof item.cwd === "string"
  );
}

export function readProcessRecord(pid: number): NuwaProcessRecord | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(recordPath(pid), "utf8"));
    return isRecord(value) && value.pid === pid ? value : null;
  } catch {
    return null;
  }
}

export function registerProcess(input: RegisterProcessInput): NuwaProcessRecord {
  const existing = readProcessRecord(input.pid);
  const record: NuwaProcessRecord = {
    version: 1,
    ...input,
    startedAt:
      input.startedAt ?? existing?.startedAt ?? new Date().toISOString(),
    processStartToken:
      getProcessStartToken(input.pid) ?? existing?.processStartToken,
  };
  writeFileAtomic(recordPath(input.pid), JSON.stringify(record, null, 2), 0o600);
  return record;
}

export function updateProcessRecord(
  pid: number,
  patch: Partial<Omit<NuwaProcessRecord, "version" | "pid">>,
): NuwaProcessRecord | null {
  const current = readProcessRecord(pid);
  if (!current) return null;
  return registerProcess({ ...current, ...patch, pid });
}

export function unregisterProcess(pid: number): void {
  try {
    fs.unlinkSync(recordPath(pid));
  } catch {
    // Missing/stale records are already unregistered.
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

async function waitUntilStopped(
  pids: number[],
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter(isPidAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    alive = alive.filter(isPidAlive);
  }
  return alive;
}

/** Gracefully stops processes, escalating after five seconds. */
export async function stopProcessIds(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  if (process.platform === "win32") {
    for (const pid of pids) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
    }
  } else {
    for (const pid of pids) signalProcess(pid, "SIGTERM");
    const stubborn = await waitUntilStopped(pids, 5000);
    for (const pid of stubborn) signalProcess(pid, "SIGKILL");
    const stillAlive = await waitUntilStopped(stubborn, 1000);
    if (stillAlive.length > 0) {
      throw new Error(
        t("processRegistry.stopFailed", { pids: stillAlive.join(", ") }),
      );
    }
  }
  for (const pid of pids) unregisterProcess(pid);
}

function isCurrentProcess(record: NuwaProcessRecord): boolean {
  if (!isPidAlive(record.pid)) return false;
  if (!record.processStartToken) return true;
  const currentToken = getProcessStartToken(record.pid);
  return !currentToken || currentToken === record.processStartToken;
}

/** Lists live registered processes and removes corrupt or stale records. */
export function listRegisteredProcesses(): NuwaProcessRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(cliProcessesDir());
  } catch (err) {
    debugLog("process.registry", "readdir failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const records: NuwaProcessRecord[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const pid = Number(name.slice(0, -5));
    const record = readProcessRecord(pid);
    if (!record || !isCurrentProcess(record)) {
      unregisterProcess(pid);
      continue;
    }
    records.push(record);
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
