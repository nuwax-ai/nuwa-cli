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
import {
  findServeProcessIds,
  stopServeProcesses,
  discoverMcpProxyProcesses,
} from "../core/processes/serveSingleton.js";
import {
  listRegisteredProcesses,
  isPidAlive,
  type NuwaProcessRecord,
} from "../core/processes/processRegistry.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { describeAutostartService } from "../core/service/serviceManager.js";
import { stopCommand } from "./processes.js";

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
    message: "Nuwax 服务器地址：",
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
  console.log(pc.green(`已登录：${result.name ?? auth.username}（${domain}）`));
}

export async function resolveLoginPassword(
  username: string,
  domain: string,
): Promise<string | null> {
  if (process.env.NUWACLI_PASSWORD) return process.env.NUWACLI_PASSWORD;
  const password = await clack.password({
    message: `${username}@${domain} 密码：`,
  });
  if (clack.isCancel(password)) return null;
  return password;
}

export async function resolveLoginUsername(): Promise<string | null> {
  const username = await clack.text({
    message: "Nuwax 用户名：",
    validate: (value) =>
      typeof value === "string" && value.trim()
        ? undefined
        : "请输入用户名",
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
        console.error(pc.dim("已取消。"));
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
        console.error(pc.dim("已取消。"));
        return;
      }
      const password = await resolveLoginPassword(options.username, domain);
      if (password === null) {
        console.error(pc.dim("已取消。"));
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
        console.error(pc.dim("已取消。"));
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
      console.error(pc.dim("已取消。"));
      return;
    }
    const username = await resolveLoginUsername();
    if (username === null) {
      console.error(pc.dim("已取消。"));
      return;
    }
    const password = await resolveLoginPassword(username, domain);
    if (password === null) {
      console.error(pc.dim("已取消。"));
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
    console.error(pc.red(`[nuwa-cli] 登录失败：${message}`));
    process.exitCode = 1;
  }
}

async function restartGatewayAfterLogin(
  runningGatewayPids: number[],
): Promise<void> {
  if (runningGatewayPids.length > 0) {
    console.log(
      pc.dim("检测到 Gateway 正在运行，正在停止以应用新登录信息..."),
    );
    await stopServeProcesses(runningGatewayPids);
  }
  // 立即用新凭证重启 Gateway（daemon，与 `nuwa-cli gateway --daemon` 同路径）。
  // login 已完成注册，传 authReady 让 gateway 跳过内部重复注册；selectEngine 非交互。
  // 不再依赖后台服务的 startService（schtasks /Run 或裸 spawn）——那条路径在受限环境
  // 下启动的 gateway 会秒退，导致登录后服务不起、用户被迫手动 `nuwa-cli gateway`。
  console.log(pc.dim("正在用新登录信息重启 Gateway..."));
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
      console.log(
        pc.dim(
          "Gateway 自动重启未成功（不影响登录态，可手动运行 `nuwa-cli gateway`）。",
        ),
      );
    }
  } catch (err) {
    console.log(
      pc.dim(
        `Gateway 自动重启失败（不影响登录态，可手动 nuwa-cli gateway）：${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
  // 确保后台服务已安装（下次登录自启）；立即启动已由上面的 gateway daemon 完成，
  // 故 now:false——避免后台服务（schtasks /Run / fallback spawn）再起一个冲突的 gateway。
  const { getServiceStatus } = await import(
    "../core/service/serviceManager.js"
  );
  if (!getServiceStatus().installed) {
    console.log(pc.dim("正在安装系统后台服务（KeepAlive，登录自启）..."));
    const { serviceInstallCommand } = await import("./service.js");
    await serviceInstallCommand({ now: false });
  }
}

export async function logoutCommand(): Promise<void> {
  // Stop first so the tunnel cannot remain online with credentials that the
  // CLI has already declared logged out.
  await stopCommand({ all: true });
  clearSessionKeepingSavedKey();
  console.log(
    pc.dim(
      "已退出登录并停止全部服务（savedKey 已保留，下次可免密登录）。",
    ),
  );
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
  const alive = records.filter((r) => isPidAlive(r.pid));
  if (alive.length > 0) {
    const detail = alive
      .map((r) => `PID ${r.pid}${r.port ? `  端口 ${r.port}` : ""}`)
      .join("，");
    console.log(`${name}：${pc.green("运行中")}  ${detail}`);
  } else {
    console.log(`${name}：${pc.dim("未运行")}`);
  }
}

async function printServeStatus(): Promise<void> {
  const status = await getServeStatus();
  if (status.state === "running") {
    console.log(
      `Gateway：${pc.green("运行中")}  端口 ${status.port}  PID ${status.pid}  启动于 ${status.startedAt}`,
    );
  } else if (status.state === "unhealthy") {
    console.log(
      `Gateway：${pc.yellow("异常")}  PID ${status.pid}  端口 ${status.port}（/health 无响应，可能仍在启动或不健康）`,
    );
  } else {
    console.log(
      `Gateway：${pc.dim("未运行")}${
        status.note ? `  ${pc.dim(status.note)}` : ""
      }（可用 \`nuwa-cli gateway\` 启动）`,
    );
  }

  // 子服务状态：file-server / lanproxy（来自进程注册表）+ mcp-proxy（按需 spawn，扫描发现）
  const registered = listRegisteredProcesses();
  printChildServiceLine(
    "file-server",
    registered.filter((r) => r.kind === "file-server"),
  );
  printChildServiceLine(
    "lanproxy",
    registered.filter((r) => r.kind === "lanproxy"),
  );
  const mcpProxyPids = discoverMcpProxyProcesses();
  console.log(
    mcpProxyPids.length > 0
      ? `mcp-proxy：${pc.green("运行中")}  PID ${mcpProxyPids.join(", ")}（按需启动）`
      : `mcp-proxy：${pc.dim("无运行实例")}（按需启动）`,
  );

  // Console：仅运行时展示，未运行则不显示该行。
  const consolePids = findUiProcessIds();
  if (consolePids.length > 0) {
    console.log(
      `Console：${pc.green("前台运行中")}  PID ${consolePids.join(", ")}`,
    );
  }

  // 开机/登录自启（KeepAlive）：与当前 Gateway 是否在跑无关，看系统启动项是否已装。
  const autostart = describeAutostartService();
  if (autostart.installed) {
    const activeLabel =
      autostart.active === null
        ? "状态未知"
        : autostart.active
          ? "服务运行中"
          : "服务未运行";
    console.log(
      `开机自启：${pc.green("已启用")}  ${autostart.methodLabel}  ${activeLabel}`,
    );
  } else {
    console.log(
      `开机自启：${pc.dim("未启用")}（登录后不会自动启动 Gateway，可用 \`nuwa-cli service install\`）`,
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
          ? "未登录（savedKey 已保存，运行 `nuwa-cli login` 免密重新登录）。"
          : "未登录。运行 `nuwa-cli login --domain <host> --saved-key <key>` 登录。",
      ),
    );
    await printServeStatus();
    return;
  }

  console.log(`域名：${credentials.domain}`);
  console.log(`用户：${credentials.username || "(未知)"}`);
  console.log(`电脑名：${credentials.computerName || "(未知)"}`);
  console.log(`savedKey：已保存`);
  console.log(`上次注册：${credentials.lastRegAt ?? "(未知)"}`);
  await printServeStatus();

  if (options.remote && credentials.domain) {
    try {
      await performReg(credentials.domain, {
        username: credentials.username ?? "",
        password: "",
        savedKey: credentials.savedKey,
      });
      console.log(pc.green("远程校验：savedKey 有效。"));
    } catch (err) {
      const message =
        err instanceof RegError ? err.message : (err as Error).message;
      console.error(pc.red(`远程校验失败：${message}`));
      process.exitCode = 1;
    }
  }
}
