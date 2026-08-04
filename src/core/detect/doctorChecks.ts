import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { cliCredentialsPath, serveLogPath } from "../../util/paths.js";
import { findOnPath, getVersion } from "../../util/which.js";
import { findServeProcessIds } from "../processes/serveSingleton.js";
import { findUiProcessIds } from "../processes/uiSingleton.js";
import { findLanproxyProcesses } from "../processes/lanproxyStatus.js";
import { resolveDefaultLanproxyBinary } from "../serve/lanproxyBinary.js";
import { getServeStatus } from "../serve/serveLock.js";
import { claudeEngine } from "../engines/claude.js";
import { codexEngine } from "../engines/codex.js";
import { checkMcpProxyEntry } from "../mcp/proxyRewrite.js";
import {
  codexAuthFile,
  codexSessionsDir,
  claudeProjectsDir,
  isEngineIsolationEnabled,
} from "../env/engineHome.js";
import { describeAutostartService } from "../service/serviceManager.js";
import { t } from "../../util/i18n/index.js";

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
    detail: ok ? `v${version}` : t("doctor.node.detailFail", { version }),
    fix: ok ? undefined : t("doctor.node.fix"),
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
        ? version
          ? t("doctor.claude.detailCliVer", { bin: binPath, ver: version })
          : t("doctor.claude.detailCli", { bin: binPath })
        : t("doctor.claude.detailBuiltin", { arg: resolved.args[0] }),
    };
  } catch (err) {
    return {
      id: "claude",
      label: "Claude ACP",
      ok: false,
      detail: (err as Error).message,
      fix: t("doctor.fix.reinstall"),
    };
  }
}

export async function checkCodex(): Promise<DoctorCheckResult> {
  const binPath = findOnPath("codex");
  const version = binPath ? getVersion(binPath) : null;
  const authFile = codexAuthFile();
  const hasAuth = fs.existsSync(authFile);
  try {
    const resolved = await codexEngine.resolve();
    const sep = t("doctor.detailSep");
    const cliPart = binPath
      ? version
        ? t("doctor.codex.detailCliVer", { bin: binPath, ver: version })
        : t("doctor.codex.detailCli", { bin: binPath })
      : t("doctor.codex.detailNoCli");
    const authPart = isEngineIsolationEnabled()
      ? t("doctor.codex.detailIsolated")
      : hasAuth
        ? t("doctor.codex.detailHasAuth")
        : t("doctor.codex.detailNoAuth");
    return {
      id: "codex",
      label: "Codex ACP",
      ok: true,
      detail: [
        t("doctor.codex.detailRuntime", { arg: resolved.args[0] }),
        cliPart,
        authPart,
      ].join(sep),
    };
  } catch (err) {
    return {
      id: "codex",
      label: "Codex ACP",
      ok: false,
      detail: (err as Error).message,
      fix: t("doctor.fix.reinstall"),
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
      detail: t("doctor.uv.detailMissing"),
      fix: t("doctor.uv.fix"),
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
    label: t("doctor.label.tcc"),
    ok: !risky,
    detail: risky
      ? t("doctor.tcc.detailRisky", { cwd })
      : t("doctor.tcc.detailOk"),
    fix: risky ? t("doctor.tcc.fix") : undefined,
    severity: "info",
  };
}

export function checkNuwaxLogin(): DoctorCheckResult {
  const credPath = cliCredentialsPath();
  if (!fs.existsSync(credPath)) {
    return {
      id: "nuwax-login",
      label: t("doctor.label.login"),
      ok: false,
      detail: t("doctor.login.detailNotLoggedIn"),
      fix: t("doctor.login.fixHint"),
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
      label: t("doctor.label.login"),
      ok,
      detail: ok
        ? t("doctor.login.detailOk", {
            domain: raw.domain ?? t("doctor.login.domainUnknown"),
          })
        : raw?.savedKey
          ? t("doctor.login.detailSavedKey")
          : t("doctor.login.detailCredNoLogin"),
      fix: ok
        ? undefined
        : raw?.savedKey
          ? t("doctor.login.fixLogin")
          : t("doctor.login.fixHint"),
      severity: "info",
    };
  } catch {
    return {
      id: "nuwax-login",
      label: t("doctor.label.login"),
      ok: false,
      detail: t("doctor.login.detailCorrupt"),
      fix: t("doctor.login.fixRelogin"),
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
      label: t("doctor.label.computer"),
      ok: Boolean(computerName),
      detail: computerName || t("doctor.computer.detailUnset"),
      severity: "info",
    };
  } catch {
    return {
      id: "nuwax-computer",
      label: t("doctor.label.computer"),
      ok: false,
      detail: t("doctor.computer.detailUnset"),
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
      fix: t("doctor.lanproxy.fixReinstall"),
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
      detail: t("doctor.lanproxy.detailRunningUnhealthy", {
        pids: running.map((item) => item.pid).join(", "),
        state:
          gateway.state === "unhealthy"
            ? t("doctor.lanproxy.healthNoResp")
            : t("doctor.lanproxy.healthDown"),
        bin: binaryPath,
      }),
      fix: t("doctor.lanproxy.fixRebuildGw", { log: serveLogPath() }),
      severity: "info",
    };
  }
  if (running.length === 0 && gateway.state === "running") {
    return {
      id: "lanproxy",
      label: "lanproxy",
      ok: false,
      detail: t("doctor.lanproxy.detailGatewayOkNoLanproxy", { bin: binaryPath }),
      fix: t("doctor.lanproxy.fixRebuildTunnel", { log: serveLogPath() }),
      severity: "info",
    };
  }
  return {
    id: "lanproxy",
    label: "lanproxy",
    ok: true,
    detail:
      running.length > 0
        ? t("doctor.lanproxy.detailRunningOk", {
            pids: running.map((item) => item.pid).join(", "),
            bin: binaryPath,
          })
        : t("doctor.lanproxy.detailInstalledNotRunning", { bin: binaryPath }),
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
    claudeProjectsDir(),
    (name) => name.endsWith(".jsonl"),
    1,
  );
  const codexCount = countFiles(
    codexSessionsDir(),
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    3,
  );
  return {
    id: "local-sessions",
    label: t("doctor.label.sessions"),
    ok: true,
    detail: t("doctor.sessions.detail", {
      claude: claudeCount,
      codex: codexCount,
    }),
    severity: "info",
  };
}

/**
 * 检测是否已安装开机/登录自启（KeepAlive）。
 * 未安装不阻塞 doctor（手动 gateway 仍可用），仅作 info 提示。
 */
export function checkAutostartService(): DoctorCheckResult {
  const autostart = describeAutostartService();
  return {
    id: "autostart",
    label: t("doctor.label.autostart"),
    ok: autostart.installed,
    detail: autostart.summary,
    fix: autostart.installed ? undefined : t("doctor.autostart.fix"),
    severity: "info",
  };
}

export function checkServeSingleton(): DoctorCheckResult {
  const pids = findServeProcessIds();
  const ok = pids.length <= 1;
  return {
    id: "serve-singleton",
    label: t("doctor.label.serveSingleton"),
    ok,
    detail:
      pids.length === 0
        ? t("doctor.serveSingleton.detailNone")
        : pids.length === 1
          ? t("doctor.serveSingleton.detailOne", { pid: pids[0] })
          : t("doctor.serveSingleton.detailMany", {
              n: pids.length,
              pids: pids.join(", "),
            }),
    fix: ok ? undefined : t("doctor.serveSingleton.fix"),
    severity: "info",
  };
}

export function checkUiSingleton(): DoctorCheckResult {
  const pids = findUiProcessIds();
  const ok = pids.length <= 1;
  return {
    id: "ui-singleton",
    label: t("doctor.label.uiSingleton"),
    ok,
    detail:
      pids.length === 0
        ? t("doctor.uiSingleton.detailNone")
        : pids.length === 1
          ? t("doctor.uiSingleton.detailOne", { pid: pids[0] })
          : t("doctor.uiSingleton.detailMany", {
              n: pids.length,
              pids: pids.join(", "),
            }),
    fix: ok ? undefined : t("doctor.uiSingleton.fix"),
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
      ? t("doctor.mcp.detailOk", { path: entryPath ?? "" })
      : t("doctor.mcp.detailMissing"),
    fix: ok ? undefined : t("doctor.mcp.fix"),
    severity: "info",
  };
}

type DoctorCheckFn = () => DoctorCheckResult | Promise<DoctorCheckResult>;

/** 单项检测步:进行中文案 + 执行函数。顺序即检测顺序。 */
interface DoctorCheckStep {
  label: string;
  run: DoctorCheckFn;
}

const DOCTOR_CHECK_STEPS: ReadonlyArray<DoctorCheckStep> = [
  { label: t("doctor.step.node"), run: () => checkNodeVersion() },
  { label: t("doctor.step.claude"), run: () => checkClaude() },
  { label: t("doctor.step.codex"), run: () => checkCodex() },
  { label: t("doctor.step.uv"), run: () => checkUv() },
  { label: t("doctor.step.tcc"), run: () => checkTccRisk() },
  { label: t("doctor.step.login"), run: () => checkNuwaxLogin() },
  { label: t("doctor.step.computer"), run: () => checkNuwaxComputer() },
  { label: t("doctor.step.lanproxy"), run: () => checkLanproxy() },
  { label: t("doctor.step.autostart"), run: () => checkAutostartService() },
  { label: t("doctor.step.mcp"), run: () => checkMcpStdioProxy() },
  { label: t("doctor.step.sessions"), run: () => checkLocalSessions() },
  { label: t("doctor.step.serveSingleton"), run: () => checkServeSingleton() },
  { label: t("doctor.step.uiSingleton"), run: () => checkUiSingleton() },
];

export async function runAllDoctorChecks(opts?: {
  onProgress?: (msg: string) => void;
}): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  for (const step of DOCTOR_CHECK_STEPS) {
    opts?.onProgress?.(step.label);
    results.push(await step.run());
  }
  return results;
}
