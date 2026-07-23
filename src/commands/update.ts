import { spawnSync } from "node:child_process";
import {
  CLI_VERSION,
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
} from "../core/version.js";
import { findOnPath, isBatchShim } from "../util/which.js";

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
  const result = spawnSync(command, args, {
    ...options,
    ...(isBatchShim(command) ? { shell: true } : {}),
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    error: result.error,
  };
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
  const args = ["install", "-g", packageSpec];
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
  runner: CommandRunner = runCommand,
): Promise<void> {
  try {
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
    console.log(`当前版本：${CLI_VERSION}`);
    console.log(`升级目标：${packageSpec}`);
    console.log(`执行：${printableCommand("npm", installArgs)}`);
    if (options.dryRun) return;

    const result = runner(command, installArgs, {
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    console.log(
      "升级命令已完成。请重新运行 `nuwa-cli --version` 确认当前 shell 解析到的新版本。",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
