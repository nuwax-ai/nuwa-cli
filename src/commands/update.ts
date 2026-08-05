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
import { withSpinner, success, dim, warn } from "../util/ui.js";
import { t } from "../util/i18n/index.js";

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
      console.log(t("update.notLoggedIn"));
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
      console.log(t("update.restarted"));
    } else {
      console.log(t("update.restartMaybeFailed", { code: exitCode ?? "unknown" }));
    }
  } catch (err) {
    console.log(
      t("update.restartSkipped", {
        msg: err instanceof Error ? err.message : String(err),
      }),
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

/** 解析 semver(核心 + 预发布);非 semver 返回 null。 */
function parseSemver(
  v: string,
): { core: [number, number, number]; pre: string[] | null } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    v,
  );
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : null };
}

function cmpPre(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === undefined) return -1; // 字段更少 = 更低
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      const d = +a[i] - +b[i];
      if (d) return d < 0 ? -1 : 1;
    } else if (an !== bn) {
      return an ? -1 : 1; // 数字标识 < 字母标识
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** semver 优先级比较:a<b→-1, a==b→0, a>b→1。非 semver 退化为字符串比较。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // 核心相等:无预发布 > 有预发布
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return cmpPre(pa.pre, pb.pre);
}

export function normalizeUpdateTarget(target?: string): string {
  const value = (target || DEFAULT_DIST_TAG).trim();
  if (!value || value.startsWith("-")) {
    throw new Error(t("update.emptyTarget"));
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
      throw new Error(t("update.noNpm"));
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
          (result.stderr || result.stdout || t("update.queryFailed")).trim(),
        );
      }
      const remoteVersion = (result.stdout || "").trim();
      console.log(t("update.currentVersion", { version: CLI_VERSION }));
      console.log(
        t("update.targetSpec", { spec: packageSpec, version: remoteVersion }),
      );
      if (remoteVersion === CLI_VERSION) console.log(t("update.alreadyTarget"));
      else
        console.log(
          t("update.canUpgrade", { from: CLI_VERSION, to: remoteVersion }),
        );
      return;
    }

    const installArgs = buildInstallArgs(packageSpec, options.registry);
    if (options.dryRun) {
      console.log(t("update.currentVersion", { version: CLI_VERSION }));
      console.log(t("update.upgradeTarget", { spec: packageSpec }));
      console.log(
        t("update.execute", { cmd: printableCommand("npm", installArgs) }),
      );
      return;
    }

    // 步骤 1/4：检查目标版本（stdio pipe，无终端输出，spinner 可独占行）
    const remoteVersion = await withSpinner(
      t("update.step1"),
      async () => {
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
        return versionResult.status === 0
          ? (versionResult.stdout || "").trim()
          : "";
      },
    );
    if (remoteVersion === CLI_VERSION) {
      console.log(success(t("update.alreadyLatest")));
      return;
    }

    // 防降级:目标版本比当前旧(例如正式版用户的 `nuwa-cli update` 命中 beta 通道)
    // 则跳过安装,不把用户降级。确需切换/降级请显式 `npm i -g ...@<version>`。
    if (remoteVersion && compareSemver(remoteVersion, CLI_VERSION) < 0) {
      console.log(
        warn(
          t("update.olderTarget", {
            current: CLI_VERSION,
            target: remoteVersion,
          }),
        ),
      );
      return;
    }

    console.log(t("update.currentVersion", { version: CLI_VERSION }));
    if (remoteVersion)
      console.log(t("update.targetVersion", { version: remoteVersion }));
    console.log(t("update.upgradeTarget", { spec: packageSpec }));
    console.log(
      t("update.execute", { cmd: printableCommand("npm", installArgs) }),
    );

    // 步骤 2/4：停止运行中的服务（异步、无 console 输出，spinner 可独占行）
    await withSpinner(t("update.step2"), () => stopRuntimeProcessesForUpdate());
    console.log(success(t("update.stopped")));

    // 步骤 3/4：安装依赖。保持 stdio:"inherit" 让 npm 自渲染进度条/spinner——
    // 不在其上叠加 CLI spinner，否则会与 npm 输出在同一终端行打架闪烁（历史踩坑）。
    console.log(dim(t("update.step3")) + packageSpec);
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
    console.log(success(t("update.installDone")));
    console.log(t("update.doneHint"));
    // 步骤 4/4：升级后按登录态重启 serve。restart 子进程走 stdio:inherit 自带输出，
    // 故这里只打一行步骤提示，不用 live spinner（避免与 inherit 输出交错）。
    console.log(dim(t("update.step4")));
    await restartServeIfLoggedIn();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
