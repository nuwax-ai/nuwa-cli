import pc from "picocolors";
import { gatewayCommand } from "./gateway.js";
import { uiCommand } from "./ui.js";

export interface RestartCommandOptions {
  /**
   * 为 true 时额外强制重启前台 Console；默认只强制重启 Gateway（daemon）。
   */
  all?: boolean;
  engine?: string;
  open?: boolean;
}

/**
 * 强制重启本地运行环境：默认只重启 Gateway daemon；
 * 传入 --all 时再强制重启前台 Console。
 */
export async function restartCommand(
  options: RestartCommandOptions,
): Promise<void> {
  const includeConsole = options.all === true;

  console.log(pc.dim("正在强制重启 Gateway Server..."));
  await gatewayCommand({
    engine: options.engine,
    daemon: true,
    force: true,
  });

  if (process.exitCode && process.exitCode !== 0) {
    console.error(
      pc.red(
        includeConsole
          ? "[nuwa-cli] Gateway 重启失败，已取消 Console 重启，避免进入部分可用状态。"
          : "[nuwa-cli] Gateway 重启失败。",
      ),
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
