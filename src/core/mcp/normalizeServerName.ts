/**
 * 将 MCP server 名规范化为 [a-zA-Z0-9_]+ 形态（与 sanitizeMcpServerNames 同规则，
 * 不含去重后缀）。用于 fold 等同名判定：`chrome-devtools` ≡ `chrome_devtools`。
 */
export function normalizeMcpServerName(name: string): string {
  let base = name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!base) base = "mcp_server";
  return base;
}
