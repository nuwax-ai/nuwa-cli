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
 * 确保 PersistentMcpBridge 已托管指定的 persistent stdio servers。
 * 单例管理在 @nuwax-ai/agent-kit（createPersistentBridge）。
 */
export async function ensurePersistentMcpBridge(
  servers: Record<string, HostStdioServerEntry>,
): Promise<PersistentMcpBridge | null> {
  return persistentBridge.ensureStarted(servers);
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

  // mergeMcpServerConfigs(DEFAULT, dynamic)：DEFAULT 为底，同名以动态为准
  const merged: Record<string, HostMcpServerEntry> = {
    ...DEFAULT_MCP_PROXY_SERVERS,
    ...map,
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
    merged[name] = resolveStdioEntry(entry);
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
