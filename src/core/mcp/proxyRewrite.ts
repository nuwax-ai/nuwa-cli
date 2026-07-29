/**
 * nuwa-cli ↔ @nuwax-ai/mcp-proxy-ts Host Adapter 封装。
 *
 * - 默认合并 Electron 同款 DEFAULT（chrome-devtools persistent）
 * - 把 ACP mcpServers 改写成「每 server 一个 proxy stdio 入口」
 * - 管理 PersistentMcpBridge（persistent 标记的 stdio server）
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
import { debugLog } from "../debugLog.js";
import { DEFAULT_MCP_PROXY_SERVERS } from "./defaultServers.js";
import type { EngineKind } from "../env/inheritEnv.js";

/** Hub 级单例 bridge；无 persistent server 时不启动。 */
let bridge: PersistentMcpBridge | null = null;

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

/**
 * 确保 PersistentMcpBridge 已托管指定的 persistent stdio servers。
 * 已运行则先 stop 再按新配置 start（配置变更场景）。
 */
export async function ensurePersistentMcpBridge(
  servers: Record<string, HostStdioServerEntry>,
): Promise<PersistentMcpBridge | null> {
  const names = Object.keys(servers);
  if (names.length === 0) {
    await stopPersistentMcpBridge();
    return null;
  }

  if (!bridge) {
    // PersistentMcpBridge 构造参数是 BridgeLogger（info/warn/error）
    bridge = new PersistentMcpBridge({
      info: (...args: unknown[]) =>
        debugLog("mcp-bridge", args.map(String).join(" ")),
      warn: (...args: unknown[]) =>
        debugLog("mcp-bridge", args.map(String).join(" ")),
      error: (...args: unknown[]) =>
        debugLog("mcp-bridge", args.map(String).join(" ")),
    });
  }

  await bridge.start(servers);
  debugLog("mcp-proxy", `PersistentMcpBridge started: ${names.join(", ")}`);
  return bridge;
}

/** serve / hub 关闭时停止 bridge，避免子进程残留。 */
export async function stopPersistentMcpBridge(): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.stop();
    debugLog("mcp-proxy", "PersistentMcpBridge stopped");
  } catch (err) {
    debugLog(
      "mcp-proxy",
      `PersistentMcpBridge stop error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    bridge = null;
  }
}

/**
 * 在交给引擎前改写 ACP mcpServers。
 *
 * 对齐 Electron syncMcpConfigToProxyAndReload：
 * - 始终以 DEFAULT（chrome-devtools persistent）为底，再叠加 ACP 动态 MCP
 * - 空列表仍注入默认服务（仅 chrome-devtools）
 * - NUWACLI_MCP_PERSISTENT 可追加其它长驻名
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

  if (Object.keys(merged).length === 0) {
    return passthrough as McpServer[];
  }

  // claude-code-acp-ts 与 nuwax-codex-acp 均原生支持 ACP stdio MCP（各自把
  // mcpServers 转成内部 MCP 配置：claude-code-acp-ts acp-agent.js、codex
  // codex_agent.rs build_session_config）。mcp-proxy-ts proxy 桥接会把 server
  // 改写成 proxy 入口形态，engine 注册不上原始 server name（codex "unknown MCP
  // server"）或工具不加载（claude）。直接下发原始 stdio 入口（DEFAULT + ACP）。
  if (engine === "codex" || engine === "claude") {
    return [...hostMapToAcpServers(merged), ...(passthrough as McpServer[])];
  }

  const proxyScriptPath = resolveProxyEntry();
  if (!proxyScriptPath) {
    debugLog(
      "mcp-proxy",
      "@nuwax-ai/mcp-proxy-ts entry not found; passing MCP through unchanged (with defaults)",
    );
    return [...hostMapToAcpServers(merged), ...(passthrough as McpServer[])];
  }

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

  const runningBridge = await ensurePersistentMcpBridge(persistent);

  const rewritten = rewriteServersToProxyCommands(merged, {
    proxyScriptPath,
    nodeBinPath: process.execPath,
    configDir: mcpProxyConfigDir(),
    logDir: mcpProxyLogDir(),
    projectId,
    bridge: runningBridge,
  });

  if (!rewritten) {
    return [...hostMapToAcpServers(merged), ...(passthrough as McpServer[])];
  }

  const out: McpServer[] = Object.entries(rewritten).map(([name, entry]) => ({
    name,
    command: entry.command,
    args: entry.args,
    // ACP McpServerStdio.env 必填（不可为 undefined）
    env: entry.env
      ? Object.entries(entry.env).map(([n, v]) => ({ name: n, value: v }))
      : [],
  }));

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
