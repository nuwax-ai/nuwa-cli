import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { cliCredentialsPath } from "../../util/paths.js";
import { findOnPath, getVersion } from "../../util/which.js";
import { findServeProcessIds } from "../processes/serveSingleton.js";
import { findUiProcessIds } from "../processes/uiSingleton.js";
import { findLanproxyProcesses } from "../processes/lanproxyStatus.js";
import { resolveDefaultLanproxyBinary } from "../serve/lanproxyBinary.js";
import { getServeStatus } from "../serve/serveLock.js";
import { claudeEngine } from "../engines/claude.js";
import { codexEngine } from "../engines/codex.js";
import { checkMcpProxyEntry } from "../mcp/proxyRewrite.js";

export interface DoctorCheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
  /**
   * "required": an unmet check means the CLI's core promise (chat with your
   * already-installed claude/codex) can't work at all — should fail the
   * overall `doctor` exit code.
   * "info": worth surfacing (with a fix hint) but doesn't block anything by
   * itself — e.g. uv/Nuwax login are opt-in features, and a lone
   * missing engine is fine as long as the other one works. Defaults to
   * "info" if omitted.
   */
  severity?: "required" | "info";
}

export function checkNodeVersion(): DoctorCheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  const ok = major >= 22;
  return {
    id: "node",
    label: "Node.js",
    ok,
    detail: ok ? `v${version}` : `v${version}（需要 >= 22）`,
    fix: ok ? undefined : "安装 Node.js 22 或更高版本：https://nodejs.org",
    severity: "required",
  };
}

export async function checkClaude(): Promise<DoctorCheckResult> {
  const binPath = findOnPath("claude");
  try {
    const resolved = await claudeEngine.resolve();
    const version = binPath ? getVersion(binPath) : null;
    return {
      id: "claude",
      label: "Claude ACP",
      ok: true,
      detail: binPath
        ? `运行时可用；本机 CLI：${binPath}${version ? ` (${version})` : ""}`
        : `内置运行时可用（${resolved.args[0]}）；未安装本机 CLI，本地历史/配置可能为空，可使用 ACP 下发配置`,
    };
  } catch (err) {
    return {
      id: "claude",
      label: "Claude ACP",
      ok: false,
      detail: (err as Error).message,
      fix: "重新安装 nuwa-cli（不要使用 --omit=optional）",
    };
  }
}

export async function checkCodex(): Promise<DoctorCheckResult> {
  const binPath = findOnPath("codex");
  const version = binPath ? getVersion(binPath) : null;
  const authFile = path.join(os.homedir(), ".codex", "auth.json");
  const hasAuth = fs.existsSync(authFile);
  try {
    const resolved = await codexEngine.resolve();
    return {
      id: "codex",
      label: "Codex ACP",
      ok: true,
      detail: [
        `运行时可用（${resolved.args[0]}）`,
        binPath
          ? `本机 CLI：${binPath}${version ? ` (${version})` : ""}`
          : "未安装本机 CLI",
        hasAuth
          ? "已检测到本地登录/配置"
          : "无本地登录/配置；本地历史与模型提示可能为空，可使用 ACP 下发配置",
      ].join("；"),
    };
  } catch (err) {
    return {
      id: "codex",
      label: "Codex ACP",
      ok: false,
      detail: (err as Error).message,
      fix: "重新安装 nuwa-cli（不要使用 --omit=optional）",
    };
  }
}

export function checkUv(): DoctorCheckResult {
  const binPath = findOnPath("uv");
  if (!binPath) {
    return {
      id: "uv",
      label: "uv",
      ok: false,
      detail: "未在 PATH 中找到（可选，部分 MCP 依赖需要）",
      fix: "安装 uv：https://docs.astral.sh/uv/getting-started/installation/",
      severity: "info",
    };
  }
  const version = getVersion(binPath);
  return {
    id: "uv",
    label: "uv",
    ok: true,
    detail: `${binPath}${version ? ` (${version})` : ""}`,
    severity: "info",
  };
}

export function checkTccRisk(): DoctorCheckResult {
  const cwd = process.cwd();
  const risky = process.platform === "darwin" && /\/Downloads(\/|$)/.test(cwd);
  return {
    id: "tcc",
    label: "macOS 权限（TCC）",
    ok: !risky,
    detail: risky
      ? `当前目录 ${cwd} 在系统权限保护范围内，子进程可能因权限不足崩溃`
      : "当前目录无已知 TCC 风险",
    fix: risky
      ? "在「系统设置 → 隐私与安全性」授予终端对该目录的完全磁盘访问权限，或切换到非受保护目录"
      : undefined,
    severity: "info",
  };
}

function noOwnLoginFixHint(): string {
  return "运行 `nuwa-cli login --domain <host> --saved-key <key>` 登录";
}

export function checkNuwaxLogin(): DoctorCheckResult {
  const credPath = cliCredentialsPath();
  if (!fs.existsSync(credPath)) {
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok: false,
      detail: "未登录",
      fix: noOwnLoginFixHint(),
      severity: "info",
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    // "logged in" tracks configKey (session validity), not savedKey (device
    // memory) — logout clears configKey but keeps savedKey, and a merely
    // remembered device must not be reported as an active login.
    const ok = Boolean(raw?.configKey);
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok,
      detail: ok
        ? `已登录（${raw.domain ?? "未知域名"}）`
        : raw?.savedKey
          ? "未登录（savedKey 已保存，可免密重新登录）"
          : "凭证文件存在但未登录",
      fix: ok
        ? undefined
        : raw?.savedKey
          ? "运行 `nuwa-cli login` 免密重新登录"
          : noOwnLoginFixHint(),
      severity: "info",
    };
  } catch {
    return {
      id: "nuwax-login",
      label: "Nuwax 云账号",
      ok: false,
      detail: "凭证文件损坏",
      fix: "运行 `nuwa-cli login` 重新登录",
      severity: "info",
    };
  }
}

export function checkNuwaxComputer(): DoctorCheckResult {
  const credPath = cliCredentialsPath();
  try {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    const computerName =
      typeof raw?.computerName === "string" ? raw.computerName.trim() : "";
    return {
      id: "nuwax-computer",
      label: "我的电脑",
      ok: Boolean(computerName),
      detail: computerName || "尚未注册，登录后由 Nuwax 分配电脑名",
      severity: "info",
    };
  } catch {
    return {
      id: "nuwax-computer",
      label: "我的电脑",
      ok: false,
      detail: "尚未注册，登录后由 Nuwax 分配电脑名",
      severity: "info",
    };
  }
}

export async function checkLanproxy(): Promise<DoctorCheckResult> {
  let binaryPath: string;
  try {
    binaryPath = resolveDefaultLanproxyBinary();
  } catch (err) {
    return {
      id: "lanproxy",
      label: "lanproxy",
      ok: false,
      detail: (err as Error).message,
      fix: "重新安装 nuwa-cli（不要使用 --omit=optional），并确认当前 npm 源已同步平台包",
      severity: "info",
    };
  }

  const running = findLanproxyProcesses();
  const gateway = await getServeStatus();
  if (running.length > 0 && gateway.state !== "running") {
    return {
      id: "lanproxy",
      label: "lanproxy",
      ok: false,
      detail: `进程运行中（PID ${running.map((item) => item.pid).join(", ")}），但 Gateway /health ${gateway.state === "unhealthy" ? "无响应" : "不可用"}；二进制：${binaryPath}`,
      fix: "运行 `nuwa-cli restart` 重启 Gateway，并检查 ~/.nuwa-cli/logs/serve.log",
      severity: "info",
    };
  }
  if (running.length === 0 && gateway.state === "running") {
    return {
      id: "lanproxy",
      label: "lanproxy",
      ok: false,
      detail: `Gateway /health 正常，但未检测到 lanproxy 进程；二进制：${binaryPath}`,
      fix: "运行 `nuwa-cli restart` 重建云端隧道，并检查 ~/.nuwa-cli/logs/serve.log",
      severity: "info",
    };
  }
  return {
    id: "lanproxy",
    label: "lanproxy",
    ok: true,
    detail:
      running.length > 0
        ? `运行中（PID ${running.map((item) => item.pid).join(", ")}），Gateway /health 正常；二进制：${binaryPath}`
        : `已安装，当前未运行；二进制：${binaryPath}`,
    severity: "info",
  };
}

/** Count session files without parsing them — cheap, bounded directory walk. */
function countFiles(
  root: string,
  matches: (name: string) => boolean,
  maxDepth: number,
): number {
  let count = 0;
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (matches(entry.name)) count++;
    }
  }
  if (fs.existsSync(root)) walk(root, 0);
  return count;
}

export function checkLocalSessions(): DoctorCheckResult {
  const claudeCount = countFiles(
    path.join(os.homedir(), ".claude", "projects"),
    (name) => name.endsWith(".jsonl"),
    1,
  );
  const codexCount = countFiles(
    path.join(os.homedir(), ".codex", "sessions"),
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    3,
  );
  return {
    id: "local-sessions",
    label: "本地会话历史",
    ok: true,
    detail: `claude: ${claudeCount} 个会话，codex: ${codexCount} 个会话`,
    severity: "info",
  };
}

export function checkServeSingleton(): DoctorCheckResult {
  const pids = findServeProcessIds();
  const ok = pids.length <= 1;
  return {
    id: "serve-singleton",
    label: "serve 单例",
    ok,
    detail:
      pids.length === 0
        ? "未运行（单例状态正常）"
        : pids.length === 1
          ? `运行中（PID ${pids[0]}）`
          : `检测到 ${pids.length} 个实例（PID ${pids.join(", ")}）`,
    fix: ok
      ? undefined
      : "运行 `nuwa-cli doctor --fix` 自动保留一个有效实例并停止其余实例",
    severity: "info",
  };
}

export function checkUiSingleton(): DoctorCheckResult {
  const pids = findUiProcessIds();
  const ok = pids.length <= 1;
  return {
    id: "ui-singleton",
    label: "Console 单例",
    ok,
    detail:
      pids.length === 0
        ? "未运行（单例状态正常）"
        : pids.length === 1
          ? `前台运行中（PID ${pids[0]}）`
          : `检测到 ${pids.length} 个前台实例（PID ${pids.join(", ")}）`,
    fix: ok
      ? undefined
      : "运行 `nuwa-cli doctor --fix` 自动保留一个 Console 并停止其余实例",
    severity: "info",
  };
}

/** 探测 @nuwax-ai/mcp-proxy-ts CLI 入口是否可解析（ACP MCP 注入依赖它）。 */
export function checkMcpStdioProxy(): DoctorCheckResult {
  const { ok, path: entryPath } = checkMcpProxyEntry();
  return {
    id: "mcp-proxy-ts",
    label: "MCP stdio proxy",
    ok,
    detail: ok
      ? `已解析 ${entryPath}`
      : "未找到 @nuwax-ai/mcp-proxy-ts 入口（dist/index.js）",
    fix: ok
      ? undefined
      : "确认已安装依赖：npm install @nuwax-ai/mcp-proxy-ts",
    severity: "info",
  };
}

export async function runAllDoctorChecks(): Promise<DoctorCheckResult[]> {
  return [
    checkNodeVersion(),
    await checkClaude(),
    await checkCodex(),
    checkUv(),
    checkTccRisk(),
    checkNuwaxLogin(),
    checkNuwaxComputer(),
    await checkLanproxy(),
    checkMcpStdioProxy(),
    checkLocalSessions(),
    checkServeSingleton(),
    checkUiSingleton(),
  ];
}
