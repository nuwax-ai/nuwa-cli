import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  CLI_VERSION,
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
} from "../core/version.js";
import { findOnPath, isBatchShim } from "../util/which.js";
import { stopProcessIds } from "../core/processes/processRegistry.js";
import {
  findServeProcessIds,
  stopServeProcesses,
  stopTunnelChildProcesses,
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
  // stdio: "inherit" lets npm render its own progress/spinner. We no longer
  // overlay an estimated \r progress bar — it clobbered npm's output on the
  // same line (flickering spinner+progress on one row).
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
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

/**
 * 升级/安装完成后：若已登录，重启所有服务（Gateway / file-server / lanproxy /
 * mcp-proxy），复用 `nuwa-cli restart` 的统一逻辑。未登录则跳过（serve 需要 Nuwax
 * 凭证才能连 Gateway）。
 *
 * 实现要点（Windows 可靠性）：以前 fire-and-forget 一个 detached `restart` 子进程
 * （detached + unref，stdio 重定向到日志），它再 spawn detached gateway daemon——这是
 * 「detached 进程派生 detached 孙进程」，Windows 上 gateway daemon 起不来（升级后服务
 * 全没起，留下指向已死 daemon 的陈旧单例锁）。改为：前台 await 一个 console-attached
 * （非 detached、stdio inherit）的 `restart` 子进程——它 spawn 的 detached daemon 与
 * `nuwa-cli gateway` 同构（前台/console-attached 进程派生 detached daemon，1 层），
 * 在 Windows 上能可靠存活。restart 在 launchDaemon 后即 return 退出，故 await 有界，
 * 还能据退出码确认是否真的拉起。
 */
async function restartServeIfLoggedIn(): Promise<void> {
  try {
    const { readCredentials } = await import("../core/auth/credentials.js");
    if (!readCredentials().configKey) {
      console.log(
        "未登录 Nuwax，已跳过升级后的服务自动重启。请先运行 `nuwa-cli login` 登录，再运行 `nuwa-cli gateway` 启动服务。",
      );
      return;
    }
    const cliEntry = process.argv[1];
    if (!cliEntry) return;
    const child = spawn(process.execPath, [cliEntry, "restart"], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", (code) => resolve(code));
    });
    if (exitCode === 0) {
      console.log("已登录，已重启所有服务（Gateway 正在后台拉起子服务）。");
    } else {
      console.log(
        `serve 自动重启可能未完成（restart 退出码 ${exitCode}）。可手动运行 \`nuwa-cli gateway\`。`,
      );
    }
  } catch (err) {
    console.log(
      `serve 自动重启跳过：${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
  const consolePids = findUiProcessIds().filter((pid) => pid !== process.pid);

  // stopServeProcesses 已内含 stopTunnelChildProcesses；无 gateway 时仍显式清一次
  // orphan file-server / lanproxy，避免升级时 Windows 锁住 nuwax-lanproxy.exe。
  if (gatewayPids.length > 0) await stopServeProcesses(gatewayPids);
  else await stopTunnelChildProcesses();
  if (consolePids.length > 0) await stopProcessIds(consolePids);
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
    // 升级后静默后台重启 serve（已登录时；未登录跳过）
    await restartServeIfLoggedIn();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
