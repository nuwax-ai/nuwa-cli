import pc from "picocolors";
import { listRegisteredProcesses } from "../core/processes/processRegistry.js";
import { findServeProcessIds } from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import {
  gatewayCommand,
  type GatewayCommandOptions,
} from "./gateway.js";
import { uiCommand } from "./ui.js";

export interface StartCommandOptions extends GatewayCommandOptions {
  open?: boolean;
}

function registeredGatewayEngine(pids: number[]): string | undefined {
  return listRegisteredProcesses().find(
    (record) => record.kind === "serve" && pids.includes(record.pid),
  )?.engine;
}

/**
 * Converges the complete local runtime to the desired state: one daemon
 * Gateway plus one foreground Console. Healthy existing instances are reused
 * unless --force is supplied.
 */
export async function startCommand(options: StartCommandOptions): Promise<void> {
  const gatewayPids = findServeProcessIds();
  const consolePids = findUiProcessIds();
  let engine = options.engine ?? registeredGatewayEngine(gatewayPids);

  if (gatewayPids.length > 0 && !options.force) {
    console.log(
      pc.green(`Gateway 已在运行（PID ${gatewayPids.join(", ")}），继续复用。`),
    );
  } else {
    console.log(
      pc.dim(
        options.force
          ? "正在强制启动 Gateway Server（daemon）..."
          : "正在启动 Gateway Server（daemon）...",
      ),
    );
    const { open: _open, ...gatewayOptions } = options;
    engine = await gatewayCommand({
      ...gatewayOptions,
      daemon: true,
      force: options.force === true,
    });
    if (process.exitCode && process.exitCode !== 0) {
      console.error(
        pc.red("[nuwa-cli] Gateway 启动失败，已取消 Console 启动。"),
      );
      return;
    }
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
