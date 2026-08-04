/**
 * 引擎隔离 home 解析 —— codex / claude-code 是否隔离到 nuwa-cli 自有 home 的唯一真相源。
 *
 * 开关:`NUWACLI_ISOLATE_ENGINES`(默认 **ON**,仅 `0/false/no/off` 时关)。直接读
 * `process.env`(不经 stripNoise),故 `buildEngineEnv` 内调用也生效。
 *
 * - ON:codex → `~/.nuwa-cli/codex-home`(`CODEX_HOME`);claude → `~/.nuwa-cli/claude-config`(`CLAUDE_CONFIG_DIR`)。
 * - OFF:回到用户真实 `~/.codex` / `~/.claude`。
 *
 * 所有 reader(discovery / uiServer / modelInfo / doctorChecks / sensitive classifier)
 * 和 `buildEngineEnv` 都走这里,翻转开关即一致重定向。用 `os.homedir()`(非缓存),沿用
 * 现有 `vi.mock("node:os")` 测试范式。
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { nuwaCliHome, ensureDir } from "../../util/paths.js";

const ISOLATE_OFF = new Set(["", "0", "false", "no", "off"]);

/** 隔离是否开启。默认 ON;仅当 `NUWACLI_ISOLATE_ENGINES` ∈ {0,false,no,off} 时 OFF。 */
export function isEngineIsolationEnabled(): boolean {
  const v = process.env.NUWACLI_ISOLATE_ENGINES;
  return !(typeof v === "string" && ISOLATE_OFF.has(v.toLowerCase()));
}

// ---- codex home 树(镜像 ~/.codex)----
export function codexHome(): string {
  return isEngineIsolationEnabled()
    ? path.join(nuwaCliHome(), "codex-home")
    : path.join(os.homedir(), ".codex");
}
export function codexSessionsDir(): string {
  return path.join(codexHome(), "sessions");
}
export function codexAuthFile(): string {
  return path.join(codexHome(), "auth.json");
}
export function codexConfigToml(): string {
  return path.join(codexHome(), "config.toml");
}

// ---- claude home 树(镜像 ~/.claude)----
export function claudeConfigDir(): string {
  return isEngineIsolationEnabled()
    ? path.join(nuwaCliHome(), "claude-config")
    : path.join(os.homedir(), ".claude");
}
export function claudeProjectsDir(): string {
  return path.join(claudeConfigDir(), "projects");
}
export function claudeSettingsFile(): string {
  return path.join(claudeConfigDir(), "settings.json");
}

/**
 * spawn 前确保隔离 home 目录存在(ON 时;OFF 时空操作)。预建 sessions/projects 子目录,
 * 避免首启与 reader 竞争。best-effort,不抛错。
 */
export function ensureIsolatedEngineHomes(engine?: "codex" | "claude"): void {
  if (!isEngineIsolationEnabled()) return;
  try {
    if (engine !== "claude") ensureDir(codexSessionsDir());
    if (engine !== "codex") ensureDir(claudeProjectsDir());
  } catch {
    // best-effort:目录创建失败不阻断启动。
  }
}

/**
 * 隔离模式下若未下发凭证(apiKey/baseUrl/model 全无),往 stderr 打一条可操作提示。
 * serve 流程云端总会下发 overlay,故仅 `chat`/本地无凭证场景会触发。只警告,不硬失败。
 */
export function warnIfIsolationAuthGap(
  engine: "codex" | "claude",
  overlay?: { apiKey?: string; baseUrl?: string; model?: string },
): void {
  if (!isEngineIsolationEnabled()) return;
  if (overlay?.apiKey || overlay?.baseUrl || overlay?.model) return;
  const name = engine === "codex" ? "codex" : "claude-code";
  const realHome = engine === "codex" ? "~/.codex" : "~/.claude";
  process.stderr.write(
    `[nuwa-cli] ${name} 运行于隔离模式且未下发凭据：不会复用 ${realHome} 的登录。` +
      `请用 --api-key/--base-url/--model 下发，或设 NUWACLI_ISOLATE_ENGINES=0 复用本机登录。\n`,
  );
}

/**
 * 一次性提示:隔离开启后,真实 `~/.codex` / `~/.claude` 里的旧会话历史不再被读取。
 * 检测到旧历史时往 stderr 提示一次,并用哨兵文件 `~/.nuwa-cli/.isolate-notice-shown` 去重。
 * 不自动迁移(安全 + 干净隔离)。best-effort,不抛错。
 */
export function maybeShowIsolationMigrationNotice(): void {
  if (!isEngineIsolationEnabled()) return;
  try {
    const sentinel = path.join(nuwaCliHome(), ".isolate-notice-shown");
    if (fs.existsSync(sentinel)) return;
    const realCodex = path.join(os.homedir(), ".codex", "sessions");
    const realClaude = path.join(os.homedir(), ".claude", "projects");
    const hasOld =
      (fs.existsSync(realCodex) && fs.readdirSync(realCodex).length > 0) ||
      (fs.existsSync(realClaude) && fs.readdirSync(realClaude).length > 0);
    if (hasOld) {
      process.stderr.write(
        "[nuwa-cli] codex/claude 现运行于隔离模式；旧历史会话仍在 ~/.codex、~/.claude（不再被读取）。" +
          "如需查看，请设 NUWACLI_ISOLATE_ENGINES=0。\n",
      );
    }
    ensureDir(nuwaCliHome());
    fs.writeFileSync(sentinel, "");
  } catch {
    // best-effort:提示失败不影响运行。
  }
}
