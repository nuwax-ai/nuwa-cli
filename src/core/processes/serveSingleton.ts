import { t } from "../../util/i18n/index.js";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  cliServeGuardPath,
  ensureDir,
  writeFileAtomic,
} from "../../util/paths.js";
import { debugLog } from "../debugLog.js";
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

/** 枚举当前所有进程的 (pid, 命令行)。Unix 用 ps，Windows 用 WMI（Win32_Process）。 */
function listProcessCommandLines(): { pid: number; commandLine: string }[] {
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
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((item) => Number.isInteger(item.ProcessId))
      .map((item) => ({
        pid: item.ProcessId as number,
        commandLine: item.CommandLine ?? "",
      }));
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
    .map((match) => ({ pid: Number(match[1]), commandLine: match[2] }));
}

export function discoverLegacyNuwaProcesses(): DiscoveredNuwaProcess[] {
  if (process.env.VITEST || process.env.NUWACLI_DISABLE_PROCESS_SCAN === "1")
    return [];
  try {
    return listProcessCommandLines().flatMap(({ pid, commandLine }) => {
      const kind =
        parseNuwaProcessKind(commandLine) ??
        parseRelativeNuwaProcessKind(commandLine, pid);
      return kind ? [{ pid, kind }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * 发现正在运行的 @nuwax-ai/mcp-proxy-ts 进程（PID 列表）。mcp-proxy 由引擎 /
 * PersistentMcpBridge 按会话需求 spawn，未进 processRegistry，只能扫描进程命令行
 * （匹配路径片段 `mcp-proxy-ts/`）来发现。返回仍存活的 PID，升序。
 */
export function discoverMcpProxyProcesses(): number[] {
  if (process.env.VITEST || process.env.NUWACLI_DISABLE_PROCESS_SCAN === "1")
    return [];
  try {
    return listProcessCommandLines()
      .filter(({ commandLine }) => /mcp-proxy-ts[\\/]/i.test(commandLine))
      .map(({ pid }) => pid)
      .filter((pid) => Number.isInteger(pid) && isPidAlive(pid))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * 停止所有正在运行的 mcp-proxy-ts 进程（best-effort，失败不阻断主流程）。
 * mcp-proxy 由引擎按会话需求 spawn、不在 processRegistry，serve 停止后常残留，
 * 故 logout / stop / restart / update 等场景需显式清理，避免泄漏。
 */
export async function stopMcpProxyProcesses(): Promise<void> {
  const pids = discoverMcpProxyProcesses();
  if (pids.length === 0) return;
  try {
    await stopProcessIds(pids);
  } catch {
    // mcp-proxy 是辅助进程，停止失败不应阻断 stop / restart / logout 等主流程。
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
  /**
   * 是否同时停 lanproxy / file-server。默认 true。
   * `repairServeSingleton` 只停重复 serve、保留主实例时必须为 false，
   * 否则会误杀仍在用的 tunnel 子进程。
   */
  stopTunnelChildren?: boolean;
}

/**
 * 停止注册表中的 tunnel 子服务（lanproxy / file-server）。
 *
 * file-server 以 detached 启动，Windows `taskkill /T` 杀 serve 时不会带走它；
 * 强制 restart / start --force 若只杀 gateway，会留下占端口的孤儿进程，下一轮
 * 只起起 gateway、lanproxy 却起不来或父进程误判「未检测到」。
 * 与 `update.ts` 升级前清理对齐；Windows 再按镜像名兜底杀 nuwax-lanproxy。
 *
 * @returns 已尝试停止的注册表 PID 列表
 */
export async function stopTunnelChildProcesses(): Promise<number[]> {
  const pids = listRegisteredProcesses()
    .filter(
      (record) =>
        (record.kind === "lanproxy" || record.kind === "file-server") &&
        record.pid !== process.pid,
    )
    .map((record) => record.pid);
  if (pids.length > 0) {
    debugLog("process.tunnel", "stopping registered tunnel children", { pids });
    await stopProcessIds(pids);
  }
  // Windows：注册表可能已过期（PID 复用/未 unregister），按可执行文件名再清一次。
  if (process.platform === "win32" && !process.env.VITEST) {
    spawnSync("taskkill", ["/F", "/IM", "nuwax-lanproxy.exe"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
  }
  return pids;
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
  // detached file-server / 残留 lanproxy：与 gateway 一并清掉，避免 force 重启残局。
  if (options.stopTunnelChildren !== false) {
    await stopTunnelChildProcesses();
  }
  // mcp-proxy 由引擎按会话 spawn、不在注册表，serve 停止后可能残留 —— 一并清理，
  // 覆盖 logout / stop / login / update 等所有走 stopServeProcesses 的场景。
  await stopMcpProxyProcesses();
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
  // 也不停 tunnel 子进程：它们挂在 retained serve 上，误杀会导致「gateway 在、lanproxy 无」。
  await stopServeProcesses(stoppedPids, {
    stopSystemService: false,
    stopTunnelChildren: false,
  });
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
      throw new Error(t("singleton.serve.starting", { pid: owner.pid }));
    }
  }
  throw new Error(t("singleton.serve.lockFail"));
}

/**
 * daemon 子进程启动时，父进程尚未完成 `transferServeSingleton` 的窗口内，
 * serve.guard 仍指向父 PID。若子进程立刻 `acquireServeSingleton(false)`，
 * 会误判「已有 serve」并秒退——表现为 start 打印了后台 pid，但 status 全未运行、
 * lanproxy 检测超时。此处轮询直到 guard 交给自己或父进程已退出。
 */
export async function waitForDaemonGuardHandoff(
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    const guard = readGuard();
    if (!guard || !isGuardAlive(guard) || guard.pid === process.pid) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  debugLog("serve.guard", "daemon handoff wait timed out", {
    selfPid: process.pid,
    guard: readGuard(),
  });
}

export async function acquireServeSingleton(force: boolean): Promise<number[]> {
  let existing = findServeProcessIds();
  if (existing.length > 0 && !force) {
    throw new Error(
      t("singleton.serve.detected", { pids: existing.join(", ") }),
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
    throw new Error(t("singleton.serve.ownerChanged"));
  }
  const payload = JSON.stringify(
    {
      pid: toPid,
      createdAt: guard.createdAt,
      processStartToken: getProcessStartToken(toPid),
    },
    null,
    2,
  );
  writeGuardWithRetry(payload);
}

/**
 * 写入 serve.guard。Windows 上 writeFileAtomic 的原子 rename 偶发 EPERM——
 * 目标 serve.guard 被杀毒/EDR 扫描、或刚 stop 的旧进程句柄短暂占用（update
 * 升级后重启 gateway 时尤甚：npm 刚改了几百个文件触发 AV 扫描）。锁通常在数百
 * ms 内释放，重试几次即可；其他平台 / 非 EPERM 错误直接抛出。
 */
function writeGuardWithRetry(payload: string): void {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileAtomic(cliServeGuardPath(), payload, 0o600);
      return;
    } catch (err) {
      lastErr = err;
      if (
        process.platform !== "win32" ||
        (err as NodeJS.ErrnoException).code !== "EPERM"
      ) {
        throw err;
      }
      // 同步短暂等待（busy-wait ~150ms）后重试，避免立即重试风暴。
      const deadline = Date.now() + 150;
      while (Date.now() < deadline) {
        /* spin */
      }
    }
  }
  throw lastErr;
}

export function releaseServeSingleton(pid = process.pid): void {
  const guard = readGuard();
  if (guard?.pid === pid) removeGuard();
  unregisterProcess(pid);
}
