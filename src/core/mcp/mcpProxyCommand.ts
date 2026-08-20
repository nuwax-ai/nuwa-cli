/**
 * 取 command 的可执行文件基名，并剥掉 Windows 后缀（.exe / .cmd / .bat），
 * 便于识别 `mcp-proxy`、`mcp-proxy.exe`、`C:\\bin\\mcp-proxy.CMD` 为同一工具。
 */
export function mcpProxyBasename(command: string): string {
  const base = command.split(/[\\/]/).at(-1) ?? command;
  return base.replace(/\.(exe|cmd|bat)$/i, "");
}

/** command 是否为 mcp-proxy（含 Windows 后缀与路径前缀）。 */
export function isMcpProxyCommand(command: string): boolean {
  return mcpProxyBasename(command) === "mcp-proxy";
}
