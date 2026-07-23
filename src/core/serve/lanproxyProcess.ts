import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import {
  registerProcess,
  unregisterProcess,
} from "../processes/processRegistry.js";
import {
  resolveDefaultLanproxyBinary,
  resolveLanproxyBinary,
} from "./lanproxyBinary.js";

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

/** 可被 AbortSignal 打断的 sleep；abort 时立即结束，不抛错。 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 进程稳定存活检查。signal abort（serve shutdown）时提前返回 false。
 */
export async function confirmLanproxyHealthy(
  pid: number | undefined,
  stabilizeMs = 1000,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!pid || signal?.aborted) return false;
  const isAlive = (p: number): boolean => {
    try {
      process.kill(p, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isAlive(pid)) return false;
  if (stabilizeMs > 0) {
    await delay(stabilizeMs, signal);
  }
  if (signal?.aborted) return false;
  return isAlive(pid);
}

/**
 * 轮询云端隧道 health。signal abort 时立即结束，避免 Ctrl+C 后仍卡满 timeoutMs。
 */
export async function waitForLanproxyTunnel(
  domain: string,
  configKey: string,
  timeoutMs = 15_000,
  intervalMs = 500,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!domain || !configKey || signal?.aborted) return false;
  const base = domain.replace(/\/+$/, "");
  const url = `${base}/api/sandbox/config/health/${encodeURIComponent(configKey)}`;
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) return false;
    try {
      const requestSignal = signal
        ? AbortSignal.any([AbortSignal.timeout(5000), signal])
        : AbortSignal.timeout(5000);
      const res = await fetch(url, { signal: requestSignal });
      if (res.ok) {
        const envelope = (await res.json()) as {
          code?: string;
          success?: boolean;
          data?: { online?: boolean };
        };
        if (
          envelope.code === "0000" ||
          envelope.success === true ||
          envelope.data?.online === true
        ) {
          return true;
        }
      }
    } catch {
      // tunnel not reachable yet / aborted
    }
    if (signal?.aborted) return false;
    await delay(intervalMs, signal);
  } while (Date.now() < deadline);
  return false;
}
