import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  CLI_VERSION,
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
} from "../core/version.js";
import { findOnPath, isBatchShim } from "../util/which.js";
import {
  listRegisteredProcesses,
  stopProcessIds,
} from "../core/processes/processRegistry.js";
import {
  findServeProcessIds,
  stopServeProcesses,
} from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";

export interface UpdateOptions {
  check?: boolean;
  dryRun?: boolean;
  registry?: string;
}

export interface CommandResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
) => CommandResult;

function runCommand(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
): CommandResult {
  const invocation = resolvePackageManagerInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, options);
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    error: result.error,
  };
}

export function estimateInstallPercent(
  startPercent: number,
  elapsedSeconds: number,
): number {
  return Math.min(
    95,
    startPercent +
      Math.floor(
        ((95 - startPercent) * elapsedSeconds) / (elapsedSeconds + 20),
      ),
  );
}

export function formatProgressBar(percent: number, label: string): string {
  const width = 30;
  const filled = Math.floor((percent * width) / 100);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${String(percent).padStart(3)}% ${label}`;
}

async function runInstallWithProgress(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const invocation = resolvePackageManagerInvocation(command, args);
  const startedAt = Date.now();
  let lastPrinted = -1;
  const render = () => {
    const percent = estimateInstallPercent(
      30,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    if (percent === lastPrinted && !process.stdout.isTTY) return;
    lastPrinted = percent;
    const line = formatProgressBar(percent, "正在下载并安装依赖（估算）");
    if (process.stdout.isTTY) process.stdout.write(`\r${line}`);
    else console.log(line);
  };

  render();
  const timer = setInterval(render, 500);
  timer.unref();

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (process.stdout.isTTY) process.stdout.write("\n");
      resolve(result);
    };
    const child = spawn(invocation.command, invocation.args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => finish({ status: null, error }));
    child.once("close", (code) => finish({ status: code }));
  });
}

export function resolvePackageManagerInvocation(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32" || !isBatchShim(command)) {
    return { command, args };
  }
  // Never execute npm.cmd through `shell:true`: cmd.exe splits an unquoted
  // "C:\Program Files\..." path and produces `'C:\Program' 不是内部或外部命令`.
  // npm.cmd and npm-cli.js are installed together by Node.js.
  const npmCli = path.win32.join(
    path.win32.dirname(command),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return { command: process.execPath, args: [npmCli, ...args] };
}

async function stopRuntimeProcessesForUpdate(): Promise<void> {
  if (process.env.VITEST) return;
  const gatewayPids = findServeProcessIds(0).filter(
    (pid) => pid !== process.pid,
  );
  const registeredChildPids = listRegisteredProcesses()
    .filter(
      (record) =>
        (record.kind === "lanproxy" || record.kind === "file-server") &&
        record.pid !== process.pid,
    )
    .map((record) => record.pid);
  const consolePids = findUiProcessIds().filter((pid) => pid !== process.pid);

  if (gatewayPids.length > 0) await stopServeProcesses(gatewayPids);
  const remaining = [...new Set([...registeredChildPids, ...consolePids])];
  if (remaining.length > 0) await stopProcessIds(remaining);
}

export function normalizeUpdateTarget(target?: string): string {
  const value = (target || DEFAULT_DIST_TAG).trim();
  if (!value || value.startsWith("-")) {
    throw new Error(
      "升级版本不能为空。示例：nuwa-cli update beta 或 nuwa-cli update 0.1.0-beta.2",
    );
  }
  return value.startsWith("v") && /^\d/.test(value.slice(1))
    ? value.slice(1)
    : value;
}

export function buildInstallArgs(
  packageSpec: string,
  registry?: string,
): string[] {
  const args = ["install", "-g", packageSpec, "--progress=true"];
  if (registry) args.push("--registry", registry);
  return args;
}

export function buildViewArgs(
  packageSpec: string,
  registry?: string,
): string[] {
  const args = ["view", packageSpec, "version"];
  if (registry) args.push("--registry", registry);
  return args;
}

function buildPackageManagerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NUWACLI_PASSWORD;
  delete env.NUWAX_CONFIG_KEY;
  delete env.NUWAX_SAVED_KEY;
  delete env.NUWACLI_SERVE_LOCK_PATH;
  return env;
}

function resolveCommand(): string | null {
  return findOnPath("npm");
}

function printableCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export async function updateCommand(
  targetArg?: string,
  options: UpdateOptions = {},
  runnerArg?: CommandRunner | unknown,
): Promise<void> {
  try {
    // Commander passes its Command instance as the final action argument.
    // Older registrations forwarded updateCommand directly, so only accept
    // an actual function as the injectable test runner.
    const runner: CommandRunner =
      typeof runnerArg === "function"
        ? (runnerArg as CommandRunner)
        : runCommand;
    const target = normalizeUpdateTarget(targetArg);
    const command = resolveCommand();
    if (!command) {
      throw new Error("未找到 npm。请先安装 Node.js/npm 后重试。");
    }

    const packageSpec = `${PACKAGE_NAME}@${target}`;
    const env = buildPackageManagerEnv();

    if (options.check) {
      const viewArgs = buildViewArgs(packageSpec, options.registry);
      const result = runner(command, viewArgs, {
        encoding: "utf-8",
        env,
        stdio: "pipe",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          (result.stderr || result.stdout || "查询 npm 版本失败。").trim(),
        );
      }
      const remoteVersion = (result.stdout || "").trim();
      console.log(`当前版本：${CLI_VERSION}`);
      console.log(`${packageSpec}：${remoteVersion}`);
      if (remoteVersion === CLI_VERSION) console.log("已是目标版本。");
      else console.log(`可升级：${CLI_VERSION} -> ${remoteVersion}`);
      return;
    }

    const installArgs = buildInstallArgs(packageSpec, options.registry);
    if (options.dryRun) {
      console.log(`当前版本：${CLI_VERSION}`);
      console.log(`升级目标：${packageSpec}`);
      console.log(`执行：${printableCommand("npm", installArgs)}`);
      return;
    }

    console.log(formatProgressBar(0, "正在检查目标版本..."));
    const versionResult = runner(
      command,
      buildViewArgs(packageSpec, options.registry),
      {
        encoding: "utf-8",
        env,
        stdio: "pipe",
      },
    );
    if (versionResult.error) throw versionResult.error;
    const remoteVersion =
      versionResult.status === 0 ? (versionResult.stdout || "").trim() : "";
    if (remoteVersion === CLI_VERSION) {
      console.log(formatProgressBar(100, "已是最新版本，无需重新安装。"));
      return;
    }

    console.log(`当前版本：${CLI_VERSION}`);
    if (remoteVersion) console.log(`目标版本：${remoteVersion}`);
    console.log(`升级目标：${packageSpec}`);
    console.log(`执行：${printableCommand("npm", installArgs)}`);

    console.log(formatProgressBar(20, "正在准备升级..."));
    console.log("正在停止 Gateway、Console、lanproxy 和文件服务，以释放升级文件...");
    await stopRuntimeProcessesForUpdate();

    console.log(formatProgressBar(30, "正在安装依赖..."));
    const result =
      typeof runnerArg === "function"
        ? runner(command, installArgs, {
            env,
            stdio: "inherit",
          })
        : await runInstallWithProgress(command, installArgs, env);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    console.log(formatProgressBar(100, "安装完成。"));
    console.log(
      "升级命令已完成。请重新运行 `nuwa-cli --version` 确认当前 shell 解析到的新版本。",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
