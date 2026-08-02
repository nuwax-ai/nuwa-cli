import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import {
  registerProcess,
  unregisterProcess,
  isPidAlive,
} from "../processes/processRegistry.js";
import {
  resolveDefaultLanproxyBinary,
  resolveLanproxyBinary,
} from "./lanproxyBinary.js";
import {
  confirmProcessHealthy,
  waitForLanproxyTunnel as kitWaitForLanproxyTunnel,
} from "@nuwax-ai/agent-kit";

export interface LanproxyStartOptions {
  pathOverride?: string;
  serverHost: string;
  serverPort: number;
  clientKey: string;
  ssl?: boolean;
}

export interface LanproxyHandle {
  pid?: number;
  command: string;
  args: string[];
  ready: Promise<void>;
  stop: () => void;
}

function normalizeServerHostForLanproxy(serverHost: string): string {
  return serverHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function startLanproxy(options: LanproxyStartOptions): LanproxyHandle {
  const command = options.pathOverride
    ? resolveLanproxyBinary(options.pathOverride)
    : resolveDefaultLanproxyBinary();
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(command, 0o755);
    } catch {
      // Best-effort: packaged resources may already be executable or readonly.
    }
  }

  const args = [
    "-s",
    normalizeServerHostForLanproxy(options.serverHost),
    "-p",
    String(options.serverPort),
    "-k",
    options.clientKey,
    `--ssl=${options.ssl !== false}`,
  ];
  const proc = spawn(command, args, {
    env: buildCliChildEnv(),
    stdio: "ignore",
    windowsHide: true,
  }) as ChildProcess;

  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    proc.once("error", (err) => {
      if (proc.pid) unregisterProcess(proc.pid);
      fail(`lanproxy 启动失败：${err.message}`);
    });
    proc.once("exit", (code, signal) => {
      if (proc.pid) unregisterProcess(proc.pid);
      fail(
        `lanproxy 启动后立即退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`,
      );
    });
    proc.once("spawn", () => {
      setTimeout(() => {
        if (settled || !proc.pid) return;
        settled = true;
        registerProcess({
          pid: proc.pid,
          kind: "lanproxy",
          state: "running",
          daemon: true,
          cwd: process.cwd(),
          host: normalizeServerHostForLanproxy(options.serverHost),
          port: options.serverPort,
        });
        resolve();
      }, 300);
    });
  });

  return {
    pid: proc.pid,
    command,
    args,
    ready,
    stop: () => {
      if (!proc.killed) proc.kill();
    },
  };
}

/**
 * 进程稳定存活检查。实现在 @nuwax-ai/agent-kit（confirmProcessHealthy），
 * isAlive 由宿主注入（nuwa-cli 用 isPidAlive）。
 */
export async function confirmLanproxyHealthy(
  pid: number | undefined,
  stabilizeMs = 1000,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!pid) return false;
  return confirmProcessHealthy({
    pid,
    stabilizeMs,
    signal,
    isAlive: isPidAlive,
  });
}

/**
 * 轮询云端隧道 health。实现在 @nuwax-ai/agent-kit（envelope 判定 + 轮询骨架），
 * 这里保留原签名返回 boolean，调用处不变。
 */
export async function waitForLanproxyTunnel(
  domain: string,
  configKey: string,
  timeoutMs = 15_000,
  intervalMs = 500,
  signal?: AbortSignal,
): Promise<boolean> {
  return (
    await kitWaitForLanproxyTunnel({
      domain,
      configKey,
      timeoutMs,
      intervalMs,
      signal,
    })
  ).healthy;
}
