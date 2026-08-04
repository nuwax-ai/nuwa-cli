import pc from "picocolors";
import { gatewayCommand } from "./gateway.js";
import { uiCommand } from "./ui.js";
import {
  findServeProcessIds,
  stopMcpProxyProcesses,
  stopTunnelChildProcesses,
} from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { stopProcessIds } from "../core/processes/processRegistry.js";
import { reportGatewayStackReadiness } from "../core/processes/lanproxyStatus.js";
import { debugLog } from "../core/debugLog.js";
import { serveLogPath } from "../util/paths.js";
import { CANCEL_EXIT_CODE } from "../util/ui.js";
import { t } from "../util/i18n/index.js";

export interface RestartCommandOptions {
  all?: boolean;
  engine?: string;
  open?: boolean;
}

/**
 * 停止所有正在运行的 serve(Gateway) + console + tunnel 子服务，给一个干净起点。
 * file-server 为 detached，不能依赖「杀 serve 进程树」自动带走，必须显式清理。
 *
 * 供 restart / doctor --fix / 登录后切换系统服务等场景复用，避免各自只停 gateway
 * 而留下 detached 子进程占端口（表现为「只重启了 gateway」）。
 */
export async function stopAllNuwaProcesses(): Promise<number> {
  const servePids = findServeProcessIds(0); // 0 = 不排除自身，全部清理
  const uiPids = findUiProcessIds();
  const allPids = [...servePids, ...uiPids].filter((pid) => pid !== process.pid);
  debugLog("restart", "stopping existing processes", { pids: allPids });
  if (allPids.length > 0) {
    await stopProcessIds(allPids);
  }
  // 即便没有 serve/console，也可能残留 detached file-server / lanproxy / mcp-proxy。
  const tunnelPids = await stopTunnelChildProcesses();
  await stopMcpProxyProcesses();
  const stopped = allPids.length + tunnelPids.length;
  // 给 OS 一点时间释放端口；测试环境跳过以免拖慢单测。
  if (stopped > 0 && !process.env.VITEST) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return stopped;
}

/**
 * 强制重启完整 serve 栈：先 stopAllNuwaProcesses 清掉所有旧进程，再以 daemon 方式
 * 强制拉起 Gateway（由其重新派生 file-server / lanproxy 等全部子服务）。
 * restart 命令、doctor --fix、安装后重启等「修复/升级后重启」场景共用此逻辑。
 */
export async function restartAllServicesForced(
  options: { engine?: string } = {},
): Promise<void> {
  // 未登录则跳过——serve/gateway 需要 Nuwax 凭证才能注册连 Gateway。统一提示先登录，
  // 覆盖 restart / doctor --fix / 升级后重启等所有走本函数的场景；不在此时走
  // ensureRegistered 的「需要 --domain」报错（那条对自动重启场景不贴切）。
  const { readCredentials } = await import("../core/auth/credentials.js");
  if (!readCredentials().configKey) {
    console.log(pc.yellow(t("restart.notLoggedIn")));
    return;
  }
  console.log(pc.dim(t("restart.cleaning")));
  const stopped = await stopAllNuwaProcesses();
  if (stopped > 0) {
    console.log(pc.green(t("restart.stoppedOld", { n: stopped })));
  } else {
    console.log(pc.dim(t("restart.noOldProcess")));
  }

  console.log(pc.dim(t("restart.restartingGateway")));
  await gatewayCommand({
    engine: options.engine,
    daemon: true,
    force: true,
  });
}

export async function restartCommand(
  options: RestartCommandOptions,
): Promise<void> {
  const includeConsole = options.all === true;

  await restartAllServicesForced({ engine: options.engine });

  if (process.exitCode && process.exitCode !== 0) {
    if (process.exitCode !== CANCEL_EXIT_CODE) {
      console.error(pc.red(t("daemon.gatewayRestartFailed")));
    }
    return;
  }

  const stackReady = await reportGatewayStackReadiness({
    spinnerMessage: t("common.waitStack"),
  });
  if (!stackReady) {
    console.error(
      pc.red(t("restart.stackNotReady", { log: serveLogPath() })),
    );
    return;
  }

  if (!includeConsole) {
    console.log(pc.dim(t("restart.gatewayRestarted")));
    // 无 KeepAlive 时提示安装登录自启，避免开机后需手动 start。
    try {
      const { getServiceStatus } = await import(
        "../core/service/serviceManager.js"
      );
      if (!getServiceStatus().installed) {
        console.log(pc.dim(t("restart.hintKeepAlive")));
      }
    } catch {
      // service 探测失败不影响 restart 主流程
    }
    return;
  }

  console.log(pc.dim(t("restart.restartingConsole")));
  await uiCommand({
    engine: options.engine,
    force: true,
    open: options.open,
  });
}
