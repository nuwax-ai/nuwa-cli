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

export async function restartCommand(
  options: RestartCommandOptions,
): Promise<void> {
  const includeConsole = options.all === true;

  // Kill ALL existing serve + console processes for a clean restart.
  console.log(pc.dim("正在清理所有已运行的 Gateway / Console 进程..."));
  const servePids = findServeProcessIds(0); // 0 = don't exclude self
  const uiPids = findUiProcessIds();
  const allPids = [...servePids, ...uiPids].filter(
    (pid) => pid !== process.pid,
  );
  if (allPids.length > 0) {
    debugLog("restart.command", "killing existing processes", {
      pids: allPids,
    });
    await stopProcessIds(allPids);
    // Give OS a moment to release ports.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(pc.green(`已停止 ${allPids.length} 个旧进程。`));
  } else {
    console.log(pc.dim("没有需要清理的旧进程。"));
  }

  console.log(pc.dim("正在强制重启 Gateway Server..."));
  await gatewayCommand({
    engine: options.engine,
    daemon: true,
    force: true,
  });

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
