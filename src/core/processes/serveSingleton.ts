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
  getProcessStartToken,
  isPidAlive,
  listRegisteredProcesses,
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
        const kind = parseNuwaProcessKind(item.CommandLine ?? "");
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
        const kind = parseNuwaProcessKind(match[2]);
        return kind ? [{ pid: Number(match[1]), kind }] : [];
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
    /(?:^|\s)(?:nuwa-cli|\S*[\\/](?:nuwa-cli|@nuwax-ai[\\/]nuwa-cli)[\\/]dist[\\/]cli\.js)\s+(serve|up|ui|chat)(?:\s|$)/i,
  );
  if (!match) return null;
  return match[1].toLowerCase() === "up"
    ? "serve"
    : (match[1].toLowerCase() as DiscoveredNuwaProcess["kind"]);
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

export async function stopServeProcesses(pids: number[]): Promise<void> {
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
      throw new Error(`无法停止旧 serve 进程：${stillAlive.join(", ")}`);
    }
  }
  for (const pid of pids) unregisterProcess(pid);
  const guard = readGuard();
  if (guard && pids.includes(guard.pid)) removeGuard();
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
  const existing = findServeProcessIds();
  if (existing.length > 0 && !force) {
    throw new Error(
      `检测到已有 nuwa-cli serve 进程（PID ${existing.join(", ")}）。同一时间只允许一个实例；确认替换时请加 --force。`,
    );
  }
  if (existing.length > 0) await stopServeProcesses(existing);
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
