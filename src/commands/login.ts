import * as clack from "@clack/prompts";
import pc from "picocolors";
import {
  registerClient,
  normalizeServerHost,
  defaultSandboxValue,
  RegError,
} from "../core/auth/regClient.js";
import {
  readCredentials,
  updateCredentials,
  clearSessionKeepingSavedKey,
  getSavedKeyForAccount,
  rememberAccountCredentials,
} from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import { printGatewayStatusLine } from "../core/serve/statusView.js";
import {
  findServeProcessIds,
  stopServeProcesses,
} from "../core/processes/serveSingleton.js";
import {
  listRegisteredProcesses,
  isPidAlive,
  type NuwaProcessRecord,
} from "../core/processes/processRegistry.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { describeAutostartService } from "../core/service/serviceManager.js";
import { stopCommand } from "./processes.js";
import { printCancelled } from "../util/ui.js";
import { t } from "../util/i18n/index.js";

export interface LoginCommandOptions {
  domain?: string;
  savedKey?: string;
  username?: string;
}

export async function resolveDomain(
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit) return normalizeServerHost(explicit);
  const existing = readCredentials();
  if (existing.domain) return existing.domain;
  const answer = await clack.text({
    message: t("login.prompt.domain"),
    placeholder: "https://agent.nuwax.com",
  });
  if (clack.isCancel(answer)) return null;
  return normalizeServerHost(answer);
}

export async function performReg(
  domain: string,
  auth: { username: string; password: string; savedKey?: string },
): Promise<void> {
  const result = await registerClient(domain, {
    username: auth.username,
    password: auth.password,
    savedKey: auth.savedKey,
    deviceId: getDeviceId(),
    sandboxConfigValue: defaultSandboxValue(),
  });
  const patch: Parameters<typeof updateCredentials>[0] = {
    domain,
    username: auth.username || undefined,
    computerName: result.name,
    configKey: result.configKey,
    savedKey: result.configKey,
    serverHost: result.serverHost,
    serverPort: result.serverPort,
    token: result.token,
    lastRegAt: new Date().toISOString(),
  };
  if (auth.username) {
    const remembered = rememberAccountCredentials({
      domain,
      username: auth.username,
      computerName: result.name,
      savedKey: result.configKey,
      serverHost: result.serverHost,
      serverPort: result.serverPort,
      lastRegAt: patch.lastRegAt,
    });
    patch.savedKeys = remembered.savedKeys;
    patch.accounts = remembered.accounts;
  }
  updateCredentials(patch);
  console.log(
    pc.green(
      t("login.loggedIn", { name: result.name ?? auth.username, domain }),
    ),
  );
}

export async function resolveLoginPassword(
  username: string,
  domain: string,
): Promise<string | null> {
  if (process.env.NUWACLI_PASSWORD) return process.env.NUWACLI_PASSWORD;
  const password = await clack.password({
    message: t("login.prompt.password", { username, domain }),
  });
  if (clack.isCancel(password)) return null;
  return password;
}

export async function resolveLoginUsername(): Promise<string | null> {
  const username = await clack.text({
    message: t("login.prompt.username"),
    validate: (value) =>
      typeof value === "string" && value.trim()
        ? undefined
        : t("login.prompt.usernameValidate"),
  });
  if (clack.isCancel(username)) return null;
  return String(username).trim();
}

export async function loginCommand(
  options: LoginCommandOptions,
): Promise<void> {
  try {
    const runningGatewayPids = findServeProcessIds();
    if (options.savedKey) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        printCancelled();
        return;
      }
      const existing = readCredentials();
      await performReg(domain, {
        username: options.username ?? existing.username ?? "",
        password: "",
        savedKey: options.savedKey,
      });
      await restartGatewayAfterLogin(runningGatewayPids);
      return;
    }

    if (options.username) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        printCancelled();
        return;
      }
      const password = await resolveLoginPassword(options.username, domain);
      if (password === null) {
        printCancelled();
        return;
      }
      await performReg(domain, {
        username: options.username,
        password,
        savedKey: getSavedKeyForAccount(domain, options.username),
      });
      await restartGatewayAfterLogin(runningGatewayPids);
      return;
    }

    const existing = readCredentials();
    if (existing.savedKey) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        printCancelled();
        return;
      }
      await performReg(domain, {
        username: existing.username ?? "",
        password: "",
        savedKey: existing.savedKey,
      });
      await restartGatewayAfterLogin(runningGatewayPids);
      return;
    }

    const domain = await resolveDomain(options.domain);
    if (!domain) {
      printCancelled();
      return;
    }
    const username = await resolveLoginUsername();
    if (username === null) {
      printCancelled();
      return;
    }
    const password = await resolveLoginPassword(username, domain);
    if (password === null) {
      printCancelled();
      return;
    }
    await performReg(domain, {
      username,
      password,
      savedKey: getSavedKeyForAccount(domain, username),
    });
    await restartGatewayAfterLogin(runningGatewayPids);
  } catch (err) {
    const message =
      err instanceof RegError ? err.message : (err as Error).message;
    console.error(pc.red(t("login.failed", { msg: message })));
    process.exitCode = 1;
  }
}

async function restartGatewayAfterLogin(
  runningGatewayPids: number[],
): Promise<void> {
  if (runningGatewayPids.length > 0) {
    console.log(pc.dim(t("login.stoppingForNewCreds")));
    await stopServeProcesses(runningGatewayPids);
  }
  // 立即用新凭证重启 Gateway（daemon，与 `nuwa-cli gateway --daemon` 同路径）。
  // login 已完成注册，传 authReady 让 gateway 跳过内部重复注册；selectEngine 非交互。
  // 不再依赖后台服务的 startService（schtasks /Run 或裸 spawn）——那条路径在受限环境
  // 下启动的 gateway 会秒退，导致登录后服务不起、用户被迫手动 `nuwa-cli gateway`。
  console.log(pc.dim(t("login.restartingWithNewCreds")));
  try {
    const { gatewayCommand } = await import("./gateway.js");
    // force:true 强制接管可能残留的 serve 实例/锁——无 force 时 daemon 子进程的
    // acquireServeSingleton 会因检测到上一个 serve（含 login 自己 gateway 进程刚
    // claim 的锁、或上一轮未清干净的 serve）而失败、秒退，表现为登录后 gateway
    // 没起来（serve.log「检测到已有 serve 进程」）。与 `nuwa-cli restart` 行为一致。
    const engine = await gatewayCommand({
      daemon: true,
      authReady: true,
      force: true,
    });
    if (!engine) {
      console.log(pc.dim(t("login.autoRestartNoEngine")));
    }
  } catch (err) {
    console.log(
      pc.dim(
        t("login.autoRestartFailed", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }
  // 确保后台服务已安装（下次登录自启）；立即启动已由上面的 gateway daemon 完成，
  // 故 now:false——避免后台服务（schtasks /Run / fallback spawn）再起一个冲突的 gateway。
  const { getServiceStatus } = await import(
    "../core/service/serviceManager.js"
  );
  if (!getServiceStatus().installed) {
    console.log(pc.dim(t("login.installingService")));
    const { serviceInstallCommand } = await import("./service.js");
    await serviceInstallCommand({ now: false });
  }
}

export async function logoutCommand(): Promise<void> {
  // Stop first so the tunnel cannot remain online with credentials that the
  // CLI has already declared logged out.
  await stopCommand({ all: true });
  clearSessionKeepingSavedKey();
  console.log(pc.dim(t("logout.done")));
}

export interface StatusCommandOptions {
  remote?: boolean;
}

/**
 * Reports whether the local Gateway is running and on which port, by reading the
 * lock `serve` writes on listen and probing `/health` (no secret needed). The
 * X-Nuwax-Internal-Secret itself is never persisted, so this can only say a
 * serve is up — to actually call `/computer/chat` the user must still grab the
 * secret from the serve process's startup output.
 */
function printChildServiceLine(
  name: string,
  records: NuwaProcessRecord[],
): void {
  const sep = t("common.labelSep");
  const alive = records.filter((r) => isPidAlive(r.pid));
  if (alive.length > 0) {
    const detail = alive
      .map((r) =>
        r.port
          ? t("status.pidPort", { pid: r.pid, port: r.port })
          : t("status.pid", { pid: r.pid }),
      )
      .join(t("status.detailSep"));
    console.log(`${name}${sep}${pc.green(t("status.running"))}  ${detail}`);
  } else {
    console.log(`${name}${sep}${pc.dim(t("status.notRunning"))}`);
  }
}

async function printServeStatus(): Promise<void> {
  const status = await getServeStatus();
  printGatewayStatusLine(status);

  // 子服务：file-server / lanproxy（注册表）+ mcp-proxy（Gateway /health 上报的 Bridge）
  const sep = t("common.labelSep");
  const registered = listRegisteredProcesses();
  printChildServiceLine(
    "file-server",
    registered.filter((r) => r.kind === "file-server"),
  );
  printChildServiceLine(
    "lanproxy",
    registered.filter((r) => r.kind === "lanproxy"),
  );
  // Bridge 随 Gateway 进程；Gateway 未运行则视为未启动。
  const mcpRunning =
    (status.state === "running" || status.state === "unhealthy") &&
    status.mcpBridge === true;
  console.log(
    mcpRunning
      ? `mcp-proxy${sep}${pc.green(t("status.running"))}`
      : `mcp-proxy${sep}${pc.dim(t("status.notRunning"))}`,
  );

  // Console：仅运行时展示，未运行则不显示该行。
  const consolePids = findUiProcessIds();
  if (consolePids.length > 0) {
    console.log(
      `Console${sep}${pc.green(t("status.foregroundRunning"))}  PID ${consolePids.join(", ")}`,
    );
  }

  // 开机/登录自启（KeepAlive）：与当前 Gateway 是否在跑无关，看系统启动项是否已装。
  const autostart = describeAutostartService();
  if (autostart.installed) {
    const activeLabel =
      autostart.active === null
        ? t("status.autostartStateUnknown")
        : autostart.active
          ? t("status.autostartServiceRunning")
          : t("status.autostartServiceStopped");
    console.log(
      `${t("doctor.label.autostart")}${sep}${pc.green(t("status.autostartEnabledWord"))}  ${autostart.methodLabel}  ${activeLabel}`,
    );
  } else {
    console.log(
      t("status.autostartDisabled", {
        disabled: pc.dim(t("status.autostartDisabledWord")),
      }),
    );
  }
}

export async function statusCommand(
  options: StatusCommandOptions,
): Promise<void> {
  const credentials = readCredentials();
  // "logged in" tracks configKey, not savedKey — mirrors the Electron
  // client's isLoggedIn(): a saved device key alone (post-logout) must never
  // be reported as an active session.
  if (!credentials.configKey) {
    console.log(
      pc.dim(
        credentials.savedKey
          ? t("status.notLoggedInSaved")
          : t("status.notLoggedInNone"),
      ),
    );
    await printServeStatus();
    return;
  }

  const unknown = t("common.unknownValue");
  console.log(t("config.domain", { value: credentials.domain ?? unknown }));
  console.log(
    t("config.username", { value: credentials.username || unknown }),
  );
  console.log(
    t("config.computerName", { value: credentials.computerName || unknown }),
  );
  console.log(t("status.savedKeySaved"));
  console.log(
    t("status.lastReg", { value: credentials.lastRegAt ?? unknown }),
  );
  await printServeStatus();

  if (options.remote && credentials.domain) {
    try {
      await performReg(credentials.domain, {
        username: credentials.username ?? "",
        password: "",
        savedKey: credentials.savedKey,
      });
      console.log(pc.green(t("status.remoteValid")));
    } catch (err) {
      const message =
        err instanceof RegError ? err.message : (err as Error).message;
      console.error(pc.red(t("status.remoteFailed", { msg: message })));
      process.exitCode = 1;
    }
  }
}
