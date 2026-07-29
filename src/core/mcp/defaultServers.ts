/**
 * 默认 MCP 配置 — 对齐 NuwaClaw Electron DEFAULT_MCP_PROXY_CONFIG。
 *
 * - chrome-devtools：persistent，由 PersistentMcpBridge 长驻托管
 * - 不使用 chrome-devtools-mcp 的 `--isolated`（靠 bridge 跨 session 保状态、避 profile 锁）
 * - ask-question / openui 不内置，仍由 ACP context_servers 动态下发
 */

import type { HostStdioServerEntry } from "@nuwax-ai/mcp-proxy-ts/host";

/**
 * 系统级内置服务（始终保留，与 Electron `DEFAULT_MCP_PROXY_CONFIG.mcpServers` 一致）。
 * 合并顺序：DEFAULT 为底，ACP/动态同名覆盖（mergeMcpServerConfigs(DEFAULT, dynamic)）。
 */
export const DEFAULT_MCP_PROXY_SERVERS: Record<string, HostStdioServerEntry> = {
  "chrome-devtools": {
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    persistent: true,
  },
};
