import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import {
  extractCommandFromRawInput,
  extractPathHaystack,
  type SensitiveClassifier,
} from "./types.js";

/**
 * 本地 session 历史访问：读 ~/.claude / ~/.codex 会话，或经 nuwa-cli context/sessions 导出。
 * 命中后即使 --approve auto（yolo）也强制走人工审批。
 *
 * 注意：这是基于命令/路径字符串的 best-effort 分类；拷贝到 /tmp 再读等绕过无法靠 regex 完备覆盖。
 * CLI 非 TTY 旁路另有 withSensitiveAccess 闸门。
 */
const NUWA_CLI_SESSION_CMD =
  /(?:^|[\s;/|&])(?:(?:npx|pnpm(?:\s+exec)?|npm\s+exec|yarn)\s+)?(?:@nuwax-ai\/)?nuwa-cli(?:\.js)?\s+(?:context|sessions)\b/i;

/** node /path/to/dist/cli.js context|sessions */
const NODE_CLI_SESSION_CMD =
  /(?:^|[\s;/|&])(?:node|nodejs)\s+\S*(?:\/|\\)(?:dist\/)?cli\.js\s+(?:context|sessions)\b/i;

const PNPM_DEV_CLI_SESSION =
  /(?:^|[\s;/|&])pnpm(?:\s+run)?\s+dev:cli\s+(?:--\s+)?(?:context|sessions)\b/i;

const SESSION_HISTORY_PATH =
  /(?:^|[/"'\\])\.claude(?:\/|\\|$)projects|(?:^|[/"'\\])\.codex(?:\/|\\$)sessions|(?:~|\$HOME|%USERPROFILE%)[\\/]\.claude|(?:~|\$HOME|%USERPROFILE%)[\\/]\.codex/i;

const SYNTHETIC_TITLES = /^(?:local_sessions_|session_history_)/i;

export const sessionHistoryAccessClassifier: SensitiveClassifier = {
  id: "session-history",

  match(request: RequestPermissionRequest): boolean {
    const title = request.toolCall.title ?? "";
    if (SYNTHETIC_TITLES.test(title)) return true;

    const command = extractCommandFromRawInput(request.toolCall.rawInput);
    if (command) {
      if (NUWA_CLI_SESSION_CMD.test(command)) return true;
      if (NODE_CLI_SESSION_CMD.test(command)) return true;
      if (PNPM_DEV_CLI_SESSION.test(command)) return true;
    }

    const haystack = extractPathHaystack(request);
    if (SESSION_HISTORY_PATH.test(haystack)) return true;

    if (
      request.toolCall.kind === "read" &&
      /local.?session|session.?histor/i.test(title)
    ) {
      return true;
    }

    return false;
  },
};
