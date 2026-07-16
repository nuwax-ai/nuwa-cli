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
