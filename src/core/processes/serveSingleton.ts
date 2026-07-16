import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  cliServeGuardPath,
  ensureDir,
  writeFileAtomic,
} from "../../util/paths.js";
import { readServeLock } from "../serve/serveLock.js";
import {
  getServiceStatus,
  stopService,
} from "../service/serviceManager.js";
import {
  getProcessStartToken,
  isPidAlive,
  listRegisteredProcesses,
  stopProcessIds,
  unregisterProcess,
} from "./processRegistry.js";

interface ServeGuard {
  pid: number;
  createdAt: string;
  processStartToken?: string;
}

export interface DiscoveredNuwaProcess {
  pid: number;
  kind: "serve" | "ui" | "chat";
}

function normalizeDiscoveredKind(
  command: string,
): DiscoveredNuwaProcess["kind"] {
  const value = command.toLowerCase();
  if (["gateway", "up", "serve"].includes(value)) return "serve";
  if (["start", "console", "ui"].includes(value)) return "ui";
  return "chat";
}

function readGuard(): ServeGuard | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(cliServeGuardPath(), "utf8"),
    ) as Partial<ServeGuard>;
    return Number.isInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.createdAt === "string"
      ? (value as ServeGuard)
      : null;
  } catch {
    return null;
  }
}

function removeGuard(): void {
  try {
    fs.unlinkSync(cliServeGuardPath());
  } catch {
    // Already absent.
  }
}

function isGuardAlive(guard: ServeGuard): boolean {
  if (!isPidAlive(guard.pid)) return false;
  if (!guard.processStartToken) return true;
  const token = getProcessStartToken(guard.pid);
  return !token || token === guard.processStartToken;
}

function processCwd(pid: number): string | null {
  try {
    if (process.platform === "linux")
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform === "darwin") {
      const result = spawnSync(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        {
          encoding: "utf8",
          timeout: 1000,
        },
      );
      const cwdLine = result.stdout
        .split("\n")
        .find((line) => line.startsWith("n"));
      return cwdLine ? cwdLine.slice(1) : null;
    }
  } catch {
    // Relative legacy commands are only included when their cwd is verifiable.
  }
  return null;
}

function parseRelativeNuwaProcessKind(
  commandLine: string,
  pid: number,
): DiscoveredNuwaProcess["kind"] | null {
  const match = commandLine.match(
    /^\s*(?:\S*[\\/])?node(?:\.exe)?\s+(?:\.[\\/])?dist[\\/]cli\.js\s+(serve|gateway|start|up|console|ui|chat)(?:\s|$)/i,
  );
  if (!match) return null;
  const cwd = processCwd(pid);
  if (!cwd) return null;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { name?: string };
    if (pkg.name !== "@nuwax-ai/nuwa-cli") return null;
  } catch {
    return null;
  }
  return normalizeDiscoveredKind(match[1]);
}

export function discoverLegacyNuwaProcesses(): DiscoveredNuwaProcess[] {
  if (process.env.VITEST || process.env.NUWACLI_DISABLE_PROCESS_SCAN === "1")
    return [];
  try {
    if (process.platform === "win32") {
      const script =
        "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        },
      );
      if (result.status !== 0 || !result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout) as
        | { ProcessId?: number; CommandLine?: string }
        | Array<{ ProcessId?: number; CommandLine?: string }>;
      return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => {
        const kind =
          parseNuwaProcessKind(item.CommandLine ?? "") ??
          (item.ProcessId
            ? parseRelativeNuwaProcessKind(
                item.CommandLine ?? "",
                item.ProcessId,
              )
            : null);
        return kind && Number.isInteger(item.ProcessId)
          ? [{ pid: item.ProcessId as number, kind }]
          : [];
      });
    }

    const result = spawnSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (result.status !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\s+(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .flatMap((match) => {
        const pid = Number(match[1]);
        const kind =
          parseNuwaProcessKind(match[2]) ??
          parseRelativeNuwaProcessKind(match[2], pid);
        return kind ? [{ pid, kind }] : [];
      });
  } catch {
    return [];
  }
}

export function isNuwaServeCommand(commandLine: string): boolean {
  return parseNuwaProcessKind(commandLine) === "serve";
}

export function parseNuwaProcessKind(
  commandLine: string,
): DiscoveredNuwaProcess["kind"] | null {
  const match = commandLine.match(
    /^\s*(?:(?:\S*[\\/])?node(?:\.exe)?\s+)?(?:nuwa-cli|\S*[\\/](?:nuwa-cli|@nuwax-ai[\\/]nuwa-cli)[\\/]dist[\\/]cli\.js)\s+(serve|gateway|start|up|console|ui|chat)(?:\s|$)/i,
  );
  if (!match) return null;
  return normalizeDiscoveredKind(match[1]);
}

export function findServeProcessIds(excludePid = process.pid): number[] {
  const pids = new Set<number>();
  const guard = readGuard();
  if (guard && isGuardAlive(guard)) pids.add(guard.pid);
  const lock = readServeLock();
  if (lock && isPidAlive(lock.pid)) pids.add(lock.pid);
  for (const record of listRegisteredProcesses()) {
    if (record.kind === "serve") pids.add(record.pid);
  }
  for (const discovered of discoverLegacyNuwaProcesses()) {
    if (discovered.kind === "serve" && isPidAlive(discovered.pid)) {
      pids.add(discovered.pid);
    }
  }
  pids.delete(excludePid);
  return [...pids].sort((a, b) => a - b);
}

export interface StopServeProcessOptions {
  stopSystemService?: boolean;
}

export async function stopServeProcesses(
  pids: number[],
  options: StopServeProcessOptions = {},
): Promise<void> {
  if (options.stopSystemService !== false && !process.env.VITEST) {
    const service = getServiceStatus();
    if (service.active) stopService();
  }
  await stopProcessIds(pids);
  const guard = readGuard();
  if (guard && pids.includes(guard.pid)) removeGuard();
}

export interface RepairServeSingletonResult {
  keptPid?: number;
  stoppedPids: number[];
}

/** Reduces any pre-existing multi-instance state to one preferred serve. */
export async function repairServeSingleton(): Promise<RepairServeSingletonResult> {
  const pids = findServeProcessIds();
  if (pids.length <= 1) return { keptPid: pids[0], stoppedPids: [] };

  const lock = readServeLock();
  const registered = listRegisteredProcesses()
    .filter((record) => record.kind === "serve" && pids.includes(record.pid))
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "running" ? -1 : 1;
      return b.startedAt.localeCompare(a.startedAt);
    });
  const keptPid =
    (lock && pids.includes(lock.pid) ? lock.pid : undefined) ??
    registered[0]?.pid ??
    pids[pids.length - 1];
  const stoppedPids = pids.filter((pid) => pid !== keptPid);

  // Do not stop launchd/systemd here: the preferred PID may be the managed
  // service itself. The singleton guard prevents a killed managed duplicate
  // from successfully rejoining if its supervisor attempts a restart.
  await stopServeProcesses(stoppedPids, { stopSystemService: false });
  claimGuard(keptPid);
  return { keptPid, stoppedPids };
}

function claimGuard(pid: number): void {
  ensureDir(path.dirname(cliServeGuardPath()));
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
      const fd = fs.openSync(cliServeGuardPath(), "wx", 0o600);
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
      throw new Error(`另一个 serve 正在启动或运行（PID ${owner.pid}）`);
    }
  }
  throw new Error("无法取得 serve 单例锁");
}

export async function acquireServeSingleton(force: boolean): Promise<number[]> {
  let existing = findServeProcessIds();
  if (existing.length > 0 && !force) {
    throw new Error(
      `检测到已有 nuwa-cli serve 进程（PID ${existing.join(", ")}）。同一时间只允许一个实例；确认替换时请加 --force。`,
    );
  }
  if (force) {
    await stopServeProcesses(existing);
    // Stopping launchd/systemd may expose a replacement PID not present in
    // the first snapshot. Sweep once more before claiming the guard.
    existing = [...new Set([...existing, ...findServeProcessIds()])].sort(
      (a, b) => a - b,
    );
    const survivors = existing.filter(isPidAlive);
    if (survivors.length > 0) await stopServeProcesses(survivors);
  }
  claimGuard(process.pid);
  return existing;
}

export function transferServeSingleton(fromPid: number, toPid: number): void {
  const guard = readGuard();
  if (!guard || guard.pid !== fromPid) {
    throw new Error("serve 单例锁所有者已变化，拒绝启动 daemon");
  }
  writeFileAtomic(
    cliServeGuardPath(),
    JSON.stringify(
      {
        pid: toPid,
        createdAt: guard.createdAt,
        processStartToken: getProcessStartToken(toPid),
      },
      null,
      2,
    ),
    0o600,
  );
}

export function releaseServeSingleton(pid = process.pid): void {
  const guard = readGuard();
  if (guard?.pid === pid) removeGuard();
  unregisterProcess(pid);
}
