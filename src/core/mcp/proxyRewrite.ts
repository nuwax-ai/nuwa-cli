/**
 * nuwa-cli ↔ @nuwax-ai/mcp-proxy-ts Host Adapter 封装。
 *
 * 对齐 nuwaclaw：
 * - PersistentMcpBridge（chrome-devtools 等 persistent）= Hub/serve 级单例
 *   「启动后一直在，直到主动 stop」
 * - serve 启动时 warmup；session 结束不杀 Bridge
 * - claude/codex：ephemeral 仍下发原始 stdio；persistent 经 proxy 接 Bridge URL
 *   （避免与 Bridge 各起一份 chrome-devtools）
 * - 其它引擎：整表改写成 proxy stdio（含 Bridge URL）
 */

import type { McpServer } from "@agentclientprotocol/sdk";
import {
  PersistentMcpBridge,
  acpServersToHostMap,
  isHostRemoteEntry,
  resolveProxyEntry,
  rewriteServersToProxyCommands,
  type AcpMcpServer,
  type HostMcpServerEntry,
  type HostStdioServerEntry,
} from "@nuwax-ai/mcp-proxy-ts/host";
import { ensureDir, logsDir, tmpDir } from "../../util/paths.js";
import { resolveStdioNoWindow } from "../../util/npxResolve.js";
import { debugLog } from "../debugLog.js";
import { DEFAULT_MCP_PROXY_SERVERS } from "./defaultServers.js";
import type { EngineKind } from "../env/inheritEnv.js";
import { createPersistentBridge, type McpProxyLogger } from "@nuwax-ai/agent-kit";

const mcpBridgeLogger: McpProxyLogger = {
  info: (...args) => debugLog("mcp-bridge", args.map(String).join(" ")),
  warn: (...args) => debugLog("mcp-bridge", args.map(String).join(" ")),
  error: (...args) => debugLog("mcp-bridge", args.map(String).join(" ")),
};

/** Hub 级 PersistentMcpBridge 单例（管理在 @nuwax-ai/agent-kit）。 */
const persistentBridge = createPersistentBridge({
  create: (logger) => new PersistentMcpBridge(logger),
  logger: mcpBridgeLogger,
  onStarted: (names) =>
    debugLog("mcp-proxy", `PersistentMcpBridge started: ${names.join(", ")}`),
  onStopped: () => debugLog("mcp-proxy", "PersistentMcpBridge stopped"),
  onStopError: (err) =>
    debugLog(
      "mcp-proxy",
      `PersistentMcpBridge stop error: ${err instanceof Error ? err.message : String(err)}`,
    ),
});

function mcpProxyLogDir(): string {
  const dir = logsDir();
  ensureDir(dir);
  return dir;
}

function mcpProxyConfigDir(): string {
  const dir = `${tmpDir()}/mcp-configs`;
  ensureDir(dir);
  return dir;
}

/**
 * 从环境变量 NUWACLI_MCP_PERSISTENT 读取需长驻的 server 名（逗号分隔）。
 * ACP 协议本身没有 persistent 字段，用此 env 作为 headless 侧补充
 *（chrome-devtools 已在 DEFAULT 中带 persistent，无需再写进 env）。
 */
function persistentNamesFromEnv(): Set<string> {
  const raw = process.env.NUWACLI_MCP_PERSISTENT ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** 对 stdio 条目做 Windows npx→node 解析。 */
function resolveStdioEntry(entry: HostStdioServerEntry): HostStdioServerEntry {
  const resolved = resolveStdioNoWindow(entry.command, entry.args ?? []);
  return { ...entry, command: resolved.command, args: resolved.args };
}

/**
 * 将云端下发的 Rust 形态 `mcp-proxy convert <url> [--protocol sse|stream]`
 * 改写为本机 TS 版入口（node + @nuwax-ai/mcp-proxy-ts dist/index.js）执行
 * 同样的 remote→stdio 转换。nuwaclaw 机器装有 Rust mcp-proxy，nuwa-cli
 * 机器只有 npm 内的 TS 版；不改写则引擎 spawn `mcp-proxy` 直接 ENOENT。
 * TS 版 CLI 参数兼容（位置参数 URL + --protocol sse|stream，原样透传）。
 */
function rewriteRustMcpProxyConvert(
  entry: HostStdioServerEntry,
): HostStdioServerEntry {
  const base = entry.command.split(/[\\/]/).at(-1) ?? entry.command;
  if (base !== "mcp-proxy" || entry.args?.[0] !== "convert") return entry;
  const proxyScriptPath = resolveProxyEntry();
  if (!proxyScriptPath) {
    // 找不到 TS 入口：保持原样（宿主环境可能自行安装了 Rust 版）
    debugLog(
      "mcp-proxy",
      "mcp-proxy convert entry kept as-is: TS proxy entry not found",
    );
    return entry;
  }
  debugLog("mcp-proxy", "rewriting rust mcp-proxy convert -> TS entry", {
    args: entry.args,
  });
  return {
    ...entry,
    command: process.execPath,
    args: [proxyScriptPath, ...(entry.args ?? [])],
  };
}

/**
 * stdio 条目的等价键（在 npx 解析改写前调用，command 仍为原始形态）：
 * - npx 形态取裸包名 —— 忽略 -y/-p 等 flag 与 @version/@latest 后缀，
 *   `npx -y chrome-devtools-mcp@latest` 与 `npx chrome-devtools-mcp` 同键；
 * - 其余命令取 `command + args` 原文（保守：参数顺序不同即不等价）。
 */
function stdioEquivalentKey(entry: HostStdioServerEntry): string {
  if (entry.command === "npx") {
    const spec =
      (entry.args ?? []).find((arg) => !arg.startsWith("-")) ?? "";
    // 去尾 @version；scoped 包（@scope/pkg）无尾版本时不受影响
    const pkg = spec.replace(/@[^/@]+$/, "");
    return pkg ? `npx:${pkg}` : "";
  }
  return `raw:${entry.command} ${(entry.args ?? []).join(" ").trim()}`;
}

/**
 * 兜底匹配（对齐 nuwaclaw mergeMcpServerConfigs「同 key 以本地为准」的去重
 * 语义，扩展到跨名等价）：云端下发的 stdio server 若与某 DEFAULT persistent
 * 条目等价 —— npx 裸包名相同，或 command+args 完全一致 —— 视为同一服务，
 * 云端条目丢弃、由 DEFAULT 条目（persistent 桥托管）兜底。避免同一
 * chrome-devtools-mcp 既进 bridge 又按 ephemeral 双开，或云端 command 在
 * 本机不可用（ENOENT）拖垮会话；定制（env/allowTools 等）以本地为准。
 */
function foldEquivalentToDefaults(
  map: Record<string, HostMcpServerEntry>,
): Record<string, HostMcpServerEntry> {
  const defaultKeys = new Map<string, string>();
  for (const [name, def] of Object.entries(DEFAULT_MCP_PROXY_SERVERS)) {
    if (isHostRemoteEntry(def) || !def.persistent) continue;
    const key = stdioEquivalentKey(def);
    if (key) defaultKeys.set(key, name);
  }
  if (defaultKeys.size === 0) return map;

  const out: Record<string, HostMcpServerEntry> = {};
  for (const [name, entry] of Object.entries(map)) {
    if (!isHostRemoteEntry(entry)) {
      const key = stdioEquivalentKey(entry);
      const hit = key ? defaultKeys.get(key) : undefined;
      if (hit && hit !== name) {
        // 跨名等价才折叠；同名条目走「动态覆盖 DEFAULT、保留 persistent」
        // 的既有语义（云端定制 command/args 不丢）。
        debugLog(
          "mcp-proxy",
          `downstream server "${name}" is equivalent to default "${hit}" (persistent), folding into default`,
        );
        continue;
      }
    }
    out[name] = entry;
  }
  return out;
}

/**
 * serve 启动时用于 warmup 的默认 persistent 集合（仅 DEFAULT，含 npx 解析）。
 * 动态 ACP / NUWACLI_MCP_PERSISTENT 追加在 rewrite 时再并入。
 */
export function buildDefaultPersistentServers(): Record<
  string,
  HostStdioServerEntry
> {
  const out: Record<string, HostStdioServerEntry> = {};
  for (const [name, entry] of Object.entries(DEFAULT_MCP_PROXY_SERVERS)) {
    if (!entry.persistent) continue;
    out[name] = { ...resolveStdioEntry(entry), persistent: true };
  }
  return out;
}

/**
 * Host map → ACP 数组形态（无 proxy 改写时的回退）。
 */
function hostMapToAcpServers(
  servers: Record<string, HostMcpServerEntry>,
): McpServer[] {
  const out: McpServer[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (isHostRemoteEntry(entry)) {
      out.push({
        type: entry.transport === "sse" ? "sse" : "http",
        name,
        url: entry.url,
        headers: entry.headers
          ? Object.entries(entry.headers).map(([n, v]) => ({
              name: n,
              value: v,
            }))
          : [],
      });
      continue;
    }
    out.push({
      name,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env
        ? Object.entries(entry.env).map(([n, v]) => ({ name: n, value: v }))
        : [],
    });
  }
  return out;
}

function proxyCommandsToAcpServers(
  rewritten: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  >,
): McpServer[] {
  return Object.entries(rewritten).map(([name, entry]) => ({
    name,
    command: entry.command,
    args: entry.args,
    env: entry.env
      ? Object.entries(entry.env).map(([n, v]) => ({ name: n, value: v }))
      : [],
  }));
}

/** 从已 merge 的 map 抽出 persistent stdio 子集。 */
function extractPersistentServers(
  merged: Record<string, HostMcpServerEntry>,
): Record<string, HostStdioServerEntry> {
  const persistentNames = persistentNamesFromEnv();
  const persistent: Record<string, HostStdioServerEntry> = {};
  for (const [name, item] of Object.entries(merged)) {
    if (isHostRemoteEntry(item)) continue;
    if (persistentNames.has(name) || item.persistent) {
      persistent[name] = {
        command: item.command,
        args: item.args,
        env: item.env,
        persistent: true,
      };
    }
  }
  return persistent;
}

/**
 * 防抖快照：上次成功 start 的 persistent 配置与 bridge 实例。
 *
 * PersistentMcpBridge.start（mcp-proxy-ts）是 stop-first 语义——已运行时先杀
 * 再起；而 agent-kit ensureStarted 无条件转发 start。宿主侧每个新 ACP 会话都
 * 会调 rewriteMcpServersForEngine → 这里，若不做比对，任意引擎/会话切换都会
 * 重启 chrome-devtools-mcp（杀浏览器实例、打断并行 agent 进行中的工具调用）。
 * 对齐 nuwaclaw mcp.ts 的 configsEqual 守卫与 agent-kit proxyBridge 契约的
 * host-diff 兜底条款：persistent 配置（稳定序列化）未变且 bridge 仍在跑时
 * 直接复用，仅真正变更才走 stop/start。
 */
let lastPersistentConfig: string | null = null;
let lastPersistentBridge: PersistentMcpBridge | null = null;

/** 稳定序列化（key 排序 + 逐项展开）：key 顺序不同但语义相同的配置视为未变。 */
function stablePersistentConfigKey(
  servers: Record<string, HostStdioServerEntry>,
): string {
  const names = Object.keys(servers).sort();
  return JSON.stringify(names.map((name) => [name, servers[name]]));
}

/**
 * 确保 PersistentMcpBridge 已托管指定的 persistent stdio servers。
 * 单例管理在 @nuwax-ai/agent-kit（createPersistentBridge）；防抖见上。
 */
export async function ensurePersistentMcpBridge(
  servers: Record<string, HostStdioServerEntry>,
): Promise<PersistentMcpBridge | null> {
  if (Object.keys(servers).length === 0) {
    // 空列表对齐 ensureStarted 语义（stop + null），并清除防抖快照。
    lastPersistentConfig = null;
    lastPersistentBridge = null;
    return persistentBridge.ensureStarted(servers);
  }
  const configKey = stablePersistentConfigKey(servers);
  if (
    lastPersistentConfig === configKey &&
    lastPersistentBridge &&
    persistentBridge.isRunning()
  ) {
    debugLog(
      "mcp-proxy",
      "persistent bridge config unchanged, reusing running bridge (no restart)",
    );
    return lastPersistentBridge;
  }
  const bridge = await persistentBridge.ensureStarted(servers);
  lastPersistentConfig = configKey;
  lastPersistentBridge = bridge;
  return bridge;
}

/**
 * serve / Gateway 启动时预热 Bridge（对齐 nuwaclaw warmup）。
 * 失败只打日志，不阻断 serve；后续 rewrite 仍会再 ensure。
 */
export async function warmupPersistentMcpBridge(): Promise<void> {
  const servers = buildDefaultPersistentServers();
  if (Object.keys(servers).length === 0) return;
  try {
    await ensurePersistentMcpBridge(servers);
    debugLog("mcp-proxy", "PersistentMcpBridge warmed", {
      servers: Object.keys(servers),
    });
  } catch (err) {
    debugLog("mcp-proxy", "PersistentMcpBridge warmup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** status 用：Bridge 是否已启动（与「有无临时 mcp-proxy-ts 进程」无关）。 */
export function isPersistentMcpBridgeRunning(): boolean {
  return persistentBridge.isRunning();
}

/** serve / hub 关闭时停止 bridge，避免子进程残留。 */
export async function stopPersistentMcpBridge(): Promise<void> {
  lastPersistentConfig = null;
  lastPersistentBridge = null;
  await persistentBridge.stop();
}

/**
 * 在交给引擎前改写 ACP mcpServers。
 *
 * 对齐 Electron syncMcpConfigToProxyAndReload：
 * - 始终以 DEFAULT（chrome-devtools persistent）为底，再叠加 ACP 动态 MCP
 * - 空列表仍注入默认服务（仅 chrome-devtools）
 * - NUWACLI_MCP_PERSISTENT 可追加其它长驻名
 * - Bridge 按 Hub 生命周期常驻；claude/codex 的 persistent 走 proxy→Bridge URL
 */
export async function rewriteMcpServersForEngine(
  servers: McpServer[] | undefined,
  projectId?: string,
  engine?: EngineKind,
): Promise<McpServer[]> {
  const acpServers = (servers ?? []) as AcpMcpServer[];
  const { map, passthrough } = acpServersToHostMap(acpServers);

  // mergeMcpServerConfigs(DEFAULT, dynamic)：DEFAULT 为底，同名以动态为准；
  // 跨名等价（如 chrome-tools ≡ chrome-devtools）先折叠回 DEFAULT 兜底。
  const merged: Record<string, HostMcpServerEntry> = {
    ...DEFAULT_MCP_PROXY_SERVERS,
    ...foldEquivalentToDefaults(map),
  };

  // 默认服务的 persistent 必须保留（对齐 Electron「chrome-devtools 始终保留、必须运行」）：
  // ACP 可覆盖 command/args，但不能把默认 persistent 抹掉。
  for (const [name, def] of Object.entries(DEFAULT_MCP_PROXY_SERVERS)) {
    const cur = merged[name];
    if (cur && !isHostRemoteEntry(cur) && def.persistent) {
      merged[name] = { ...cur, persistent: true };
    }
  }

  // Resolve `npx` (a .cmd shim on Windows) → `node + npx-cli.js` for every stdio
  // server, so the engine / PersistentMcpBridge spawn node directly instead of
  // flashing a cmd.exe console on each MCP start (nuwaclaw `spawnNoWindow` trick;
  // npx warmup + npm update already do the same). Remote entries pass through.
  for (const [name, entry] of Object.entries(merged)) {
    if (isHostRemoteEntry(entry)) continue;
    merged[name] = resolveStdioEntry(rewriteRustMcpProxyConvert(entry));
  }
  const passthroughResolved = (passthrough as AcpMcpServer[]).map((server) => {
    if (!("command" in server)) return server;
    const resolved = resolveStdioNoWindow(server.command, server.args ?? []);
    return { ...server, command: resolved.command, args: resolved.args };
  });

  if (Object.keys(merged).length === 0) {
    return passthroughResolved as McpServer[];
  }

  const persistent = extractPersistentServers(merged);
  // 无论引擎：先确保 Bridge 起来（Hub 级常驻；与 session 无关）。
  const runningBridge = await ensurePersistentMcpBridge(persistent);

  const proxyScriptPath = resolveProxyEntry();

  // claude / codex：ephemeral 原生 stdio；persistent 经 proxy 接 Bridge，避免双开。
  if (engine === "codex" || engine === "claude") {
    const ephemeral: Record<string, HostMcpServerEntry> = {};
    const persistentOnly: Record<string, HostMcpServerEntry> = {};
    for (const [name, entry] of Object.entries(merged)) {
      if (persistent[name]) persistentOnly[name] = entry;
      else ephemeral[name] = entry;
    }

    const out: McpServer[] = [...hostMapToAcpServers(ephemeral)];

    if (Object.keys(persistentOnly).length > 0) {
      if (proxyScriptPath && runningBridge) {
        const rewritten = rewriteServersToProxyCommands(persistentOnly, {
          proxyScriptPath,
          nodeBinPath: process.execPath,
          configDir: mcpProxyConfigDir(),
          logDir: mcpProxyLogDir(),
          projectId,
          bridge: runningBridge,
        });
        if (rewritten) out.push(...proxyCommandsToAcpServers(rewritten));
        else out.push(...hostMapToAcpServers(persistentOnly));
      } else {
        // 无 proxy 脚本或 Bridge 未起：退回原始 stdio（可能与 warmup 失败并存）
        out.push(...hostMapToAcpServers(persistentOnly));
      }
    }

    debugLog(
      "mcp-proxy",
      `${engine}: ephemeral stdio + persistent via bridge/proxy`,
      {
        ephemeral: Object.keys(ephemeral),
        persistent: Object.keys(persistentOnly),
        bridgeRunning: persistentBridge.isRunning(),
      },
    );
    return [...out, ...(passthroughResolved as McpServer[])];
  }

  if (!proxyScriptPath) {
    debugLog(
      "mcp-proxy",
      "@nuwax-ai/mcp-proxy-ts entry not found; passing MCP through unchanged (with defaults)",
    );
    return [...hostMapToAcpServers(merged), ...(passthroughResolved as McpServer[])];
  }

  const rewritten = rewriteServersToProxyCommands(merged, {
    proxyScriptPath,
    nodeBinPath: process.execPath,
    configDir: mcpProxyConfigDir(),
    logDir: mcpProxyLogDir(),
    projectId,
    bridge: runningBridge,
  });

  if (!rewritten) {
    return [...hostMapToAcpServers(merged), ...(passthroughResolved as McpServer[])];
  }

  const out = proxyCommandsToAcpServers(rewritten);

  debugLog(
    "mcp-proxy",
    `rewrote ${acpServers.length} ACP + ${Object.keys(DEFAULT_MCP_PROXY_SERVERS).length} default → ${out.length} proxy entry(ies)`,
  );
  return [...out, ...(passthrough as McpServer[])];
}

/** doctor 用：探测 proxy CLI 入口是否可解析。 */
export function checkMcpProxyEntry(): {
  ok: boolean;
  path: string | null;
} {
  const path = resolveProxyEntry();
  return { ok: !!path, path };
}
