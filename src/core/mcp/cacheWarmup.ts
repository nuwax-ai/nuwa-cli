/**
 * MCP npx 缓存预热 — serve 启动期后台 best-effort
 *
 * serve 模式下 `@nuwax-ai/mcp-proxy-ts`（及 PersistentMcpBridge）会按配置 spawn
 * `npx -y <pkg>@<spec>` 拉起 MCP server，首包现下载（慢、且可能因 registry/网络
 * 抖动失败）。本模块在 serve 启动时静默预热默认 npx 缓存（`~/.npm/_npx` 或用户
 * NPM_CONFIG_CACHE 下的 `_npx`），使运行时直接命中、零网络、秒级拉起。
 *
 * 策略：spawn `npx -y <spec>` → 轮询 `_npx/<hash>/node_modules/<pkg>` 命中 → kill。
 * - 系统 PATH 上的 npx（Windows 上 npx.cmd → node.exe + npx-cli.js，仿 update.ts）
 * - 串行、每包超时 5min、best-effort 绝不抛错、绝不阻塞 serve 端口绑定
 * - 幂等：标记文件 + isPackageInNpxCache 谓词双判（谓词为唯一真理，应对缓存被清自愈）
 *
 * 注意：nuwa-cli 不重定向 npm cache（无 NPM_CONFIG_CACHE 覆盖），故预热落默认
 * `~/.npm/_npx`，与 serve 运行时 spawn 的 npx 同缓存空间。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { debugLog } from "../debugLog.js";
import { CLI_VERSION } from "../version.js";
import { nuwaCliHome, writeFileAtomic } from "../../util/paths.js";
import { findOnPath, isBatchShim } from "../../util/which.js";

/**
 * 预热目标包。spec 字符串须与 serve 下游运行时实际下发的 spec 逐字一致，
 * 否则 npx 算出不同 _npx hash、不命中。把本常量视为「合约」：
 * - chrome-devtools 须与 src/core/mcp/defaultServers.ts 的 DEFAULT_MCP_PROXY_SERVERS 保持一致
 * - ask-question / openui 由后端 ACP context_servers 下发，须对齐 @latest（openui registry 无 0.3.0）
 */
export const MCP_WARMUP_SPECS = [
  "nuwax-ask-question-mcp@latest",
  "@nuwax-ai/openui-mcp@latest",
  "chrome-devtools-mcp@latest",
] as const;

/** 单包预热超时；chrome-devtools-mcp 体积较大，慢网/Win 首拉常 >60–90s */
export const MCP_WARMUP_PER_PKG_TIMEOUT_MS = 300_000;
export const MCP_WARMUP_POLL_INTERVAL_MS = 500;
const WARMUP_KILL_GRACE_MS = 3_000;
const WARMUP_STATE_FILENAME = "mcp-cache-warmup.json";

export type McpCacheWarmupOptions = {
  /** 测试注入：自定义 spawn（返回 kill + onClose 句柄） */
  spawnNpx?: (
    pkgSpec: string,
    env: NodeJS.ProcessEnv,
  ) => { kill: (sig?: NodeJS.Signals) => void; onClose: Promise<number | null> };
  /** 测试注入：判定包是否已入缓存（默认 isPackageInNpxCache） */
  isCached?: (npxDir: string, pkgName: string) => boolean;
  /** 测试注入：当前时间戳 */
  now?: () => number;
  /** 测试/调用方注入：cli 版本（默认 CLI_VERSION） */
  cliVersion?: string;
  /** 覆盖单包超时 */
  perPkgTimeoutMs?: number;
  /** 覆盖轮询间隔 */
  pollIntervalMs?: number;
  /** 覆盖 kill 优雅宽限 */
  killGraceMs?: number;
  /** 强制重预热，忽略标记/缓存命中 */
  force?: boolean;
};

export type McpCacheWarmupResult = {
  skipped: boolean;
  reason?: string;
  warmed: string[];
  failed: { spec: string; error: string }[];
  npxDir: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 从 spec 解析出包名：去 `@version`，保留 `@scope/name`。
 * - `nuwax-ask-question-mcp@latest` → `nuwax-ask-question-mcp`
 * - `@nuwax-ai/openui-mcp@latest`    → `@nuwax-ai/openui-mcp`
 */
export function pkgNameFromSpec(spec: string): string {
  if (spec.startsWith("@")) {
    const idx = spec.indexOf("@", 1);
    return idx === -1 ? spec : spec.slice(0, idx);
  }
  const idx = spec.lastIndexOf("@");
  return idx === -1 ? spec : spec.slice(0, idx);
}

/**
 * 扫描 `_npx/<hash>/node_modules/<pkg>` 判定包是否已入缓存。
 * 与 npx 内部 hash 算法无关——只要任一 hash 目录下有该包即视为命中。
 */
export function isPackageInNpxCache(npxDir: string, pkgName: string): boolean {
  if (!npxDir || !fs.existsSync(npxDir)) return false;
  let entries: string[];
  try {
    entries = fs.readdirSync(npxDir);
  } catch {
    return false;
  }
  for (const hash of entries) {
    if (fs.existsSync(path.join(npxDir, hash, "node_modules", pkgName))) {
      return true;
    }
  }
  return false;
}

/**
 * 解析预热用的 npx 命令。
 * Windows 上 npx.cmd → node.exe + npx-cli.js（避免 cmd.exe /c 脆弱引号，
 * 与 update.ts 的 resolvePackageManagerInvocation 同模式）。找不到 npx 返回 null。
 */
export function resolveWarmupNpxCommand(): {
  command: string;
  args: (spec: string) => string[];
} | null {
  const npxPath = findOnPath("npx");
  if (!npxPath) return null;
  if (!isBatchShim(npxPath)) {
    return { command: npxPath, args: (spec) => ["-y", spec] };
  }
  const npxCli = path.join(
    path.dirname(npxPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  if (fs.existsSync(npxCli)) {
    return { command: process.execPath, args: (spec) => [npxCli, "-y", spec] };
  }
  return null;
}

/**
 * 预热子进程 env：继承 process.env，剔除密钥；并与运行时 mcp-proxy-ts 的
 * getDefaultEnvironment() allowlist 对齐——显式删除 NPM_CONFIG_CACHE / npm_config_cache，
 * 让预热与运行时都落默认 `~/.npm/_npx`。否则用户自定义 NPM_CONFIG_CACHE 时，预热写到
 * /custom/_npx、运行时取 ~/.npm/_npx，永不命中且 marker 错误标记已预热（silent failure）。
 */
function buildWarmupEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NUWACLI_PASSWORD;
  delete env.NUWAX_CONFIG_KEY;
  delete env.NUWAX_SAVED_KEY;
  delete env.NUWACLI_SERVE_LOCK_PATH;
  // 与运行时 allowlist 对齐：不传 npm cache 指向，两端都用默认 ~/.npm（见 getNpxCacheDir）
  delete env.NPM_CONFIG_CACHE;
  delete env.npm_config_cache;
  return env;
}

/** npx 缓存目录：NPM_CONFIG_CACHE（若用户设了）或默认 ~/.npm，下接 _npx */
function getNpxCacheDir(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.NPM_CONFIG_CACHE || path.join(os.homedir(), ".npm");
  return path.join(cacheRoot, "_npx");
}

type WarmupState = {
  cliVersion: string;
  npxDir: string;
  specs: string[];
  warmedAt: number;
};

function getWarmupStatePath(): string {
  return path.join(nuwaCliHome(), WARMUP_STATE_FILENAME);
}

function readWarmupState(): WarmupState | null {
  try {
    const p = getWarmupStatePath();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (
      typeof data?.cliVersion === "string" &&
      typeof data?.npxDir === "string" &&
      Array.isArray(data?.specs)
    ) {
      return {
        cliVersion: data.cliVersion,
        npxDir: data.npxDir,
        specs: data.specs,
        warmedAt: typeof data.warmedAt === "number" ? data.warmedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeWarmupState(state: WarmupState): void {
  try {
    writeFileAtomic(getWarmupStatePath(), JSON.stringify(state));
  } catch (err) {
    debugLog("serve.warmup", "state-write-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function spawnNpxDefault(
  cmd: { command: string; args: (spec: string) => string[] },
  spec: string,
  env: NodeJS.ProcessEnv,
): { kill: (sig?: NodeJS.Signals) => void; onClose: Promise<number | null> } {
  const child = spawn(cmd.command, cmd.args(spec), {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  // 不阻止父进程（serve）退出：serve 收到定向 SIGTERM/SIGINT 关闭时，未 unref 的子进程
  // handle 会拖住事件循环；unref 后 serve 可干净退出，孤儿 npx 下载完自然结束（best-effort）。
  child.unref();
  const onClose = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  return { kill: (sig) => child.kill(sig), onClose };
}

/**
 * 预热单个 spec：spawn npx → 轮询缓存命中 → kill 常驻进程。
 * 返回 true 表示已入缓存；false 表示超时或进程异常退出且未命中。
 */
async function warmupOne(
  spec: string,
  pkgName: string,
  cmd: { command: string; args: (spec: string) => string[] },
  env: NodeJS.ProcessEnv,
  npxDir: string,
  opts: Required<
    Pick<
      McpCacheWarmupOptions,
      "isCached" | "now" | "perPkgTimeoutMs" | "pollIntervalMs" | "killGraceMs"
    >
  >,
  spawnNpx?: McpCacheWarmupOptions["spawnNpx"],
): Promise<boolean> {
  const handle = spawnNpx ? spawnNpx(spec, env) : spawnNpxDefault(cmd, spec, env);

  const deadline = opts.now() + opts.perPkgTimeoutMs;
  let closed = false;
  handle.onClose.then(() => {
    closed = true;
  });

  try {
    while (opts.now() < deadline) {
      if (opts.isCached(npxDir, pkgName)) return true; // 命中：下载已完成
      if (closed) return opts.isCached(npxDir, pkgName); // 进程已退出：再校验一次
      await sleep(opts.pollIntervalMs);
    }
    return false; // 超时
  } finally {
    // 无论命中/超时/退出，都收尾 kill 常驻子进程；SIGTERM → 宽限 → SIGKILL
    handle.kill("SIGTERM");
    await Promise.race([handle.onClose, sleep(opts.killGraceMs)]);
    handle.kill("SIGKILL"); // 已退出则 kill 为 no-op
  }
}

/**
 * serve 启动期后台预热 MCP npx 缓存。best-effort，绝不抛错。
 */
export async function warmupMcpNpxCache(
  options?: McpCacheWarmupOptions,
): Promise<McpCacheWarmupResult> {
  const env = buildWarmupEnv();
  const npxDir = getNpxCacheDir(env);
  const isCached = options?.isCached ?? isPackageInNpxCache;
  const now = options?.now ?? Date.now;
  const perPkgTimeoutMs =
    options?.perPkgTimeoutMs ?? MCP_WARMUP_PER_PKG_TIMEOUT_MS;
  const pollIntervalMs =
    options?.pollIntervalMs ?? MCP_WARMUP_POLL_INTERVAL_MS;
  const killGraceMs = options?.killGraceMs ?? WARMUP_KILL_GRACE_MS;
  const cliVersion = options?.cliVersion ?? CLI_VERSION;
  const specs = [...MCP_WARMUP_SPECS];

  const empty = (
    reason: string,
    extra: Partial<McpCacheWarmupResult> = {},
  ): McpCacheWarmupResult => ({
    skipped: true,
    reason,
    warmed: [],
    failed: [],
    npxDir,
    ...extra,
  });

  const cmd = resolveWarmupNpxCommand();
  if (!cmd) return empty("npx unavailable");

  // 幂等：标记 + 缓存命中双判。谓词为唯一真理——标记只用于避免冗余 spawn；
  // 若缓存被清（标记仍在），下次启动谓词检测到缺失会重新预热（自愈）。
  if (!options?.force) {
    const state = readWarmupState();
    const markerMatches =
      state?.cliVersion === cliVersion &&
      state.npxDir === npxDir &&
      specs.every((s) => state.specs.includes(s));
    if (markerMatches && specs.every((s) => isCached(npxDir, pkgNameFromSpec(s)))) {
      return empty("already warmed");
    }
  }

  const warmed: string[] = [];
  const failed: { spec: string; error: string }[] = [];

  // 串行预热：对 registry/CPU 友好、避免 _npx 锁竞争
  for (const spec of specs) {
    const pkgName = pkgNameFromSpec(spec);
    if (isCached(npxDir, pkgName)) {
      warmed.push(spec); // 已在缓存，记为成功
      continue;
    }
    try {
      const ok = await warmupOne(spec, pkgName, cmd, env, npxDir, {
        isCached,
        now,
        perPkgTimeoutMs,
        pollIntervalMs,
        killGraceMs,
      }, options?.spawnNpx);
      if (ok) warmed.push(spec);
      else failed.push({ spec, error: "timeout or not cached after spawn" });
    } catch (err) {
      failed.push({
        spec,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed.length === 0) {
    writeWarmupState({ cliVersion, npxDir, specs: warmed, warmedAt: now() });
  }

  debugLog("serve.warmup", "done", {
    skipped: false,
    warmed: warmed.length,
    failed: failed.length,
    failedSpecs: failed.length ? failed.map((f) => f.spec) : undefined,
  });
  return { skipped: false, warmed, failed, npxDir };
}
