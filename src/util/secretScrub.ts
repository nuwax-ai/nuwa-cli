/**
 * 落盘日志的密文兜底脱敏。
 *
 * nuwa-cli 自身的 debugLog 在写入前已按 meta 键名脱敏（debugLog.ts 的
 * redact()），但两类日志绕过了它：
 * - codex 适配器（`@nuwax-ai/nuwax-codex-acp-ts`）的 app-server.log 会完整
 *   dump thread/start / thread/resume 的 config，其中 `experimental_bearer_token`
 *   携带网关 ak- 明文；
 * - serve daemon 的 stdout/stderr 整体重定向进 serve.<date>.log，历史上把
 *   启动横幅里的 X-Nuwax-Internal-Secret 一并落盘。
 *
 * 这里做值级模式替换（键名保留，便于排查"此处曾有 token"），由 logSweep
 * 的每小时维护对上述文件就地清洗。best-effort：绝不抛错；就地截断重写与
 * 适配器的逐行 append 存在毫秒级竞态，极端时丢一行调试日志，可接受。
 */

import * as fs from "node:fs";

/** 超过此大小的文件跳过清洗，限制每小时维护的内存/IO 上限。 */
const MAX_SCRUB_FILE_BYTES = 32 * 1024 * 1024;

/** [pattern, replacement] 顺序即应用顺序；均为全局正则。 */
const SCRUB_RULES: Array<[RegExp, string]> = [
  // 网关 bearer token（`"experimental_bearer_token":"ak-…"` 及其转义嵌套形态）。
  [/ak-[0-9a-fA-F]{8,}/g, "ak-REDACTED"],
  // `X-Nuwax-Internal-Secret: <value>`（启动横幅 / 头部回显）。
  [/(X-Nuwax-Internal-Secret[ \t]*:[ \t]*)[^\s"',}]+/gi, "$1REDACTED"],
  // `Authorization: Bearer <token>`（token 部分限定长度，避免误伤单词 Bearer）。
  [/(\bBearer[ \t]+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1REDACTED"],
  // JSON 键值形态的长密钥值。仅匹配完整键名，tokenUsage 等统计字段不受影响。
  [
    /("(?:api_key|apiKey|access_token|accessToken|saved_key|savedKey|authorization|experimental_bearer_token)"[ \t]*:[ \t]*)"[^"]{8,}"/g,
    '$1"(redacted)"',
  ],
];

/** 快速探测文本是否疑似含密文（决定是否值得跑完整替换/回写）。 */
export function textLooksSecretish(text: string): boolean {
  return (
    /ak-[0-9a-fA-F]{8,}/.test(text) ||
    /X-Nuwax-Internal-Secret[ \t]*:[ \t]*[^\s]/i.test(text) ||
    /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{12,}/i.test(text) ||
    /"(?:api_key|apiKey|access_token|accessToken|saved_key|savedKey|authorization|experimental_bearer_token)"[ \t]*:[ \t]*"[^"]{8,}"/.test(
      text,
    )
  );
}

/** 对文本应用全部脱敏规则；无命中时原样返回（同一引用）。 */
export function scrubSecretsInText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SCRUB_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 就地清洗单个日志文件。
 * 返回 true 表示文件含密文且已重写；false 表示无需清洗或 best-effort 失败。
 */
export function scrubSecretsInLogFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return false;
    if (stat.size > MAX_SCRUB_FILE_BYTES) return false;
    const text = fs.readFileSync(filePath, "utf8");
    if (!textLooksSecretish(text)) return false;
    const cleaned = scrubSecretsInText(text);
    if (cleaned === text) return false;
    fs.writeFileSync(filePath, cleaned, "utf8");
    return true;
  } catch {
    return false;
  }
}
