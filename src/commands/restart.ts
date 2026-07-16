import pc from "picocolors";
import { gatewayCommand } from "./gateway.js";
import { uiCommand } from "./ui.js";

export interface RestartCommandOptions {
  all: boolean;
  engine?: string;
  open?: boolean;
}

/**
 * Restarts the complete local runtime. Gateway is relaunched as a daemon while
 * the current process becomes the one allowed foreground Console instance.
 */
export async function restartCommand(
  options: RestartCommandOptions,
): Promise<void> {
  console.log(pc.dim("正在强制重启 Gateway Server..."));
  await gatewayCommand({
    engine: options.engine,
    daemon: true,
    force: true,
  });

  if (process.exitCode && process.exitCode !== 0) {
    console.error(
      pc.red(
        "[nuwa-cli] Gateway 重启失败，已取消 Console 重启，避免进入部分可用状态。",
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
