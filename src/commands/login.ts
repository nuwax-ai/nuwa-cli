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
  // 登录成功后改用系统级后台服务（macOS LaunchAgent / Linux systemd / Windows
  // 计划任务）托管 gateway —— KeepAlive 会在 serve 被注销/退出后自动拉起。
  if (runningGatewayPids.length > 0) {
    console.log(
      pc.dim("检测到 Gateway 正在运行，正在应用新登录信息并切换到系统后台服务..."),
    );
    await stopServeProcesses(runningGatewayPids);
  }
  // 任务定义不含凭证（gateway 运行时从 credentials.json 读取），因此系统服务已
  // 安装时无需重装——否则 Windows 上对已存在/运行中的计划任务做 schtasks /Create /F
  // 会「拒绝访问」(ERROR_ACCESS_DENIED)。未安装才安装；已安装则直接启动以应用新登录信息。
  const { getServiceStatus, startService } = await import(
    "../core/service/serviceManager.js"
  );
  if (getServiceStatus().installed) {
    console.log(pc.dim("系统后台服务已安装，正在启动以应用新登录信息..."));
    try {
      startService();
    } catch (err) {
      console.log(
        pc.dim(
          `系统服务启动失败（不影响登录态）：${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  } else {
    console.log(
      pc.dim("登录成功，正在安装系统后台服务（KeepAlive，退出自动拉起）..."),
    );
    const { serviceInstallCommand } = await import("./service.js");
    await serviceInstallCommand({ now: true });
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
    console.log(
      pc.dim(
        `  地址 http://${status.host}:${status.port}（X-Nuwax-Internal-Secret 仅启动时打印，未落盘）`,
      ),
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
