import pc from "picocolors";
import { gatewayCommand } from "./gateway.js";
import { uiCommand } from "./ui.js";
import { findServeProcessIds } from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { stopProcessIds } from "../core/processes/processRegistry.js";
import { debugLog } from "../core/debugLog.js";

export interface RestartCommandOptions {
  all?: boolean;
  engine?: string;
  open?: boolean;
}

/**
 * 停止所有正在运行的 serve(Gateway) + console 进程，给一个干净起点。serve 的
 * detached 子服务（file-server/lanproxy）会随 serve 的优雅关闭/进程树一并清理。
 * 返回停止的进程数；无运行进程时返回 0（no-op）。
 *
 * 供 restart / doctor --fix / 登录后切换系统服务等场景复用，避免各自只停 gateway
 * 而留下 detached 子进程占端口（表现为「只重启了 gateway」）。
 */
export async function stopAllNuwaProcesses(): Promise<number> {
  const servePids = findServeProcessIds(0); // 0 = 不排除自身，全部清理
  const uiPids = findUiProcessIds();
  const allPids = [...servePids, ...uiPids].filter((pid) => pid !== process.pid);
  if (allPids.length === 0) return 0;
  debugLog("restart", "stopping existing processes", { pids: allPids });
  await stopProcessIds(allPids);
  // 给 OS 一点时间释放端口 / 清理 detached 子进程。
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return allPids.length;
}

/**
 * 强制重启完整 serve 栈：先 stopAllNuwaProcesses 清掉所有旧进程，再以 daemon 方式
 * 强制拉起 Gateway（由其重新派生 file-server / lanproxy 等全部子服务）。
 * restart 命令、doctor --fix、安装后重启等「修复/升级后重启」场景共用此逻辑。
 */
export async function restartAllServicesForced(
  options: { engine?: string } = {},
): Promise<void> {
  console.log(pc.dim("正在清理所有已运行的 Gateway / Console 进程..."));
  const stopped = await stopAllNuwaProcesses();
  if (stopped > 0) {
    console.log(pc.green(`已停止 ${stopped} 个旧进程。`));
  } else {
    console.log(pc.dim("没有需要清理的旧进程。"));
  }

  console.log(pc.dim("正在强制重启 Gateway Server..."));
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
    console.error(
      pc.red("[nuwa-cli] Gateway 重启失败。"),
    );
    return;
  }

  if (!includeConsole) {
    console.log(
      pc.dim(
        "Gateway 已重启。需要同时重启 Console 时请运行 `nuwa-cli restart --all`。",
      ),
    );
    return;
  }

  console.log(pc.dim("正在强制重启前台 Console..."));
  await uiCommand({
    engine: options.engine,
    force: true,
    open: options.open,
  });
}
