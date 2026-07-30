import pc from "picocolors";
import { readCredentials } from "../core/auth/credentials.js";
import { listRegisteredProcesses } from "../core/processes/processRegistry.js";
import { waitForLanproxyProcess } from "../core/processes/lanproxyStatus.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import { findServeProcessIds } from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import {
  gatewayCommand,
  type GatewayCommandOptions,
} from "./gateway.js";
import { uiCommand } from "./ui.js";
import { loginCommand } from "./login.js";

export interface StartCommandOptions extends GatewayCommandOptions {
  /**
   * 为 true 时额外启动前台 Console；默认只启动/复用 Gateway（daemon）。
   */
  all?: boolean;
  open?: boolean;
}

function registeredGatewayEngine(pids: number[]): string | undefined {
  return listRegisteredProcesses().find(
    (record) => record.kind === "serve" && pids.includes(record.pid),
  )?.engine;
}

/**
 * 收敛本地运行环境：默认只保证 Gateway daemon 就绪；
 * 传入 --all 时再启动/复用前台 Console。健康实例默认复用，除非 --force。
 */
export async function startCommand(options: StartCommandOptions): Promise<void> {
  let authReady = false;
  if (!readCredentials().configKey) {
    console.log(pc.dim("尚未登录 Nuwax，请先完成登录。"));
    await loginCommand({
      domain: options.domain,
      username: options.username,
      savedKey: options.savedKey,
    });
    if (!readCredentials().configKey) {
      console.error(pc.dim("未完成登录，已取消启动。"));
      return;
    }
    authReady = true;
  }

  const gatewayPids = findServeProcessIds();
  const consolePids = findUiProcessIds();
  let engine = options.engine ?? registeredGatewayEngine(gatewayPids);
  // --all 才包含前台 Console；默认仅 Gateway
  const includeConsole = options.all === true;

  if (gatewayPids.length > 0 && !options.force) {
    // Check if child services (lanproxy, file-server) are healthy.
    // If not, force restart to bring them all back up — "reuse" a serve
    // whose children died is worse than a clean restart.
    const lanproxyAlive = await waitForLanproxyProcess();
    const gatewayStatus = await getServeStatus();
    if (lanproxyAlive && gatewayStatus.state === "running") {
      console.log(
        pc.green(`Gateway 已在运行（PID ${gatewayPids.join(", ")}），继续复用。`),
      );
    } else {
      console.log(
        pc.yellow(
          `Gateway PID ${gatewayPids.join(", ")} 存在，但子服务（lanproxy/file-server）缺失，正在强制重启 Gateway 以恢复完整运行环境...`,
        ),
      );
      engine = await gatewayCommand({
        ...(options as Omit<StartCommandOptions, "open" | "all">),
        daemon: true,
        force: true,
        ...(authReady ? { authReady: true } : {}),
      });
      if (process.exitCode && process.exitCode !== 0) {
        console.error(
          pc.red("[nuwa-cli] Gateway 重启失败。"),
        );
        return;
      }
    }
  } else {
    console.log(
      pc.dim(
        options.force
          ? "正在强制启动 Gateway Server（daemon）..."
          : "正在启动 Gateway Server（daemon）...",
      ),
    );
    // 剥离 start 专属选项，避免传给 gatewayCommand
    const { open: _open, all: _all, ...gatewayOptions } = options;
    engine = await gatewayCommand({
      ...gatewayOptions,
      daemon: true,
      force: options.force === true,
      ...(authReady ? { authReady: true } : {}),
    });
    if (process.exitCode && process.exitCode !== 0) {
      console.error(
        pc.red(
          includeConsole
            ? "[nuwa-cli] Gateway 启动失败，已取消 Console 启动。"
            : "[nuwa-cli] Gateway 启动失败。",
        ),
      );
      return;
    }
  }

  const lanproxy = await waitForLanproxyProcess();
  if (lanproxy) {
    const gatewayStatus = await getServeStatus();
    if (gatewayStatus.state === "running") {
      console.log(
        pc.green(
          `lanproxy 运行中（PID ${lanproxy.pid}，${lanproxy.host ?? "未知主机"}:${lanproxy.port ?? "未知端口"}），Gateway /health 正常。`,
        ),
      );
    } else {
      console.error(
        pc.yellow(
          `[nuwa-cli] lanproxy 进程存在（PID ${lanproxy.pid}），但 Gateway /health 不可用；请查看 ~/.nuwa-cli/logs/serve.log。`,
        ),
      );
    }
  } else {
    console.error(
      pc.yellow(
        "[nuwa-cli] 未检测到运行中的 lanproxy；请查看 ~/.nuwa-cli/logs/serve.log 或运行 `nuwa-cli doctor`。",
      ),
    );
  }

  // 默认（无 --all）只保证 Gateway，不占用当前终端
  if (!includeConsole) {
    console.log(
      pc.dim("Gateway 已就绪。需要 Console 时请运行 `nuwa-cli start --all` 或 `nuwa-cli console`。"),
    );
    return;
  }

  if (consolePids.length > 0 && !options.force) {
    console.log(
      pc.green(
        `Console 已在运行（PID ${consolePids.join(", ")}），完整运行环境已就绪。`,
      ),
    );
    return;
  }

  console.log(
    pc.dim(
      options.force ? "正在强制启动前台 Console..." : "正在启动前台 Console...",
    ),
  );
  await uiCommand({
    engine,
    cwd: options.cwd,
    approve: options.approve,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    force: options.force === true,
    open: options.open,
  });
}
