import pc from "picocolors";
import { readCredentials } from "../core/auth/credentials.js";
import { listRegisteredProcesses } from "../core/processes/processRegistry.js";
import {
  GATEWAY_STACK_READY_TIMEOUT_MS,
  isGatewayStackReady,
  reportGatewayStackReadiness,
  waitForGatewayStackReady,
} from "../core/processes/lanproxyStatus.js";
import { findServeProcessIds } from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import {
  gatewayCommand,
  type GatewayCommandOptions,
} from "./gateway.js";
import { uiCommand } from "./ui.js";
import { loginCommand } from "./login.js";
import { CANCEL_EXIT_CODE, withSpinner } from "../util/ui.js";
import { t } from "../util/i18n/index.js";

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
    console.log(pc.dim(t("start.notLoggedIn")));
    await loginCommand({
      domain: options.domain,
      username: options.username,
      savedKey: options.savedKey,
    });
    if (!readCredentials().configKey) {
      console.error(pc.dim(t("start.loginCancelled")));
      return;
    }
    authReady = true;
  }

  const gatewayPids = findServeProcessIds();
  const consolePids = findUiProcessIds();
  let engine = options.engine ?? registeredGatewayEngine(gatewayPids);
  // --all 才包含前台 Console；默认仅 Gateway
  const includeConsole = options.all === true;
  let stackReady = false;

  if (gatewayPids.length > 0 && !options.force) {
    // 开机自启（Windows 计划任务 / 启动文件夹 KeepAlive）常在登录后已拉起 Gateway，
    // 但 tunnel（注册 → file-server → lanproxy）仍在进行。这里必须用完整就绪超时
    // 等待，而不是短轮询后立刻 --force：否则会杀掉刚起来的自启实例，日志表现为
    // 「lanproxy 已启动」紧接着又 force 停掉，用户侧则报「未检测到 lanproxy」。
    const ready = await withSpinner(
      t("start.waitExisting", {
        pids: gatewayPids.join(", "),
        secs: Math.round(GATEWAY_STACK_READY_TIMEOUT_MS / 1000),
      }),
      () => waitForGatewayStackReady(GATEWAY_STACK_READY_TIMEOUT_MS),
    );
    if (isGatewayStackReady(ready) && ready.lanproxy) {
      console.log(
        pc.green(t("start.reusing", { pids: gatewayPids.join(", ") })),
      );
      console.log(
        pc.green(
          t("start.lanproxyReady", {
            pid: ready.lanproxy.pid,
            host: ready.lanproxy.host ?? t("daemon.unknownHost"),
            port: ready.lanproxy.port ?? t("daemon.unknownPort"),
          }),
        ),
      );
      stackReady = true;
    } else {
      console.log(
        pc.yellow(
          t("start.forceRestartReason", { pids: gatewayPids.join(", ") }),
        ),
      );
      engine = await gatewayCommand({
        ...(options as Omit<StartCommandOptions, "open" | "all">),
        daemon: true,
        force: true,
        ...(authReady ? { authReady: true } : {}),
      });
      if (process.exitCode && process.exitCode !== 0) {
        // 130 = 用户取消(已在 gatewayCommand 内打印灰色提示),不算失败。
        if (process.exitCode !== CANCEL_EXIT_CODE) {
          console.error(pc.red(t("daemon.gatewayRestartFailed")));
        }
        return;
      }
      stackReady = await reportGatewayStackReadiness({
        spinnerMessage: t("common.waitStack"),
      });
    }
  } else {
    console.log(
      pc.dim(
        options.force
          ? t("start.startingDaemonForce")
          : t("start.startingDaemon"),
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
      if (process.exitCode !== CANCEL_EXIT_CODE) {
        console.error(
          pc.red(
            includeConsole
              ? t("start.gatewayStartFailedConsole")
              : t("start.gatewayStartFailed"),
          ),
        );
      }
      return;
    }
    stackReady = await reportGatewayStackReadiness({
      spinnerMessage: t("common.waitStack"),
    });
  }

  // 默认（无 --all）只保证 Gateway，不占用当前终端
  if (!includeConsole) {
    if (stackReady) {
      console.log(pc.dim(t("start.gatewayReady")));
    }
    return;
  }

  if (!stackReady) {
    console.error(pc.red(t("start.stackNotReady")));
    return;
  }

  if (consolePids.length > 0 && !options.force) {
    console.log(
      pc.green(
        t("start.consoleAlreadyRunning", { pids: consolePids.join(", ") }),
      ),
    );
    return;
  }

  console.log(
    pc.dim(
      options.force
        ? t("start.startingConsoleForce")
        : t("start.startingConsole"),
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
