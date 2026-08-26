/**
 * Product uninstall (`nuwa-cli uninstall`).
 *
 * Preferred entry: `npx @nuwax-ai/nuwa-cli@latest uninstall`
 * (npx runs a fresh copy so npm can remove the global tree while services
 * and vendor locks are released first).
 *
 * Default: remove OS autostart + stop runtime + `npm uninstall -g`.
 * User data under `~/.nuwa-cli` (credentials / sessions / logs) is KEPT.
 * Pass `--purge` to delete that directory after a successful package removal
 * (or when the package was already gone).
 *
 * Distinct from `service uninstall` (OS keep-alive only).
 */
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as clack from "@clack/prompts";
import { PACKAGE_NAME } from "../core/version.js";
import { uninstallService as removeOsAutostartService } from "../core/service/serviceManager.js";
import { stopRuntimeProcessesForUpdate } from "../core/processes/upgradeStop.js";
import { findOnPath } from "../util/which.js";
import { nuwaCliHome } from "../util/paths.js";
import {
  CANCEL_EXIT_CODE,
  isCI,
  isInteractive,
  printCancelled,
  success,
  warn,
} from "../util/ui.js";
import { t } from "../util/i18n/index.js";
import { isPackageGloballyInstalled } from "./install.js";
import {
  buildPackageManagerEnv,
  resolvePackageManagerInvocation,
  type CommandResult,
  type CommandRunner,
} from "./update.js";

export interface UninstallOptions {
  /** Also delete `~/.nuwa-cli` (credentials / sessions / logs / workspaces). */
  purge?: boolean;
  /** Skip interactive confirmation (CI / Agent / automation). */
  yes?: boolean;
  registry?: string;
}

/**
 * Injectable side effects for unit tests. Production uses real service /
 * stop / filesystem helpers.
 */
export interface UninstallDeps {
  removeOsAutostart: () => void;
  stopRuntime: () => Promise<void>;
  homeDir: () => string;
  purgeHome: (dir: string) => void;
  homeExists: (dir: string) => boolean;
}

const defaultDeps: UninstallDeps = {
  removeOsAutostart: () => {
    removeOsAutostartService();
  },
  stopRuntime: () => stopRuntimeProcessesForUpdate(),
  homeDir: () => nuwaCliHome(),
  purgeHome: (dir) => {
    fs.rmSync(dir, { recursive: true, force: true });
  },
  homeExists: (dir) => fs.existsSync(dir),
};

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

function printableCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function buildUninstallArgs(registry?: string): string[] {
  const args = ["uninstall", "-g", PACKAGE_NAME];
  if (registry) args.push("--registry", registry);
  return args;
}

async function confirmUninstall(options: UninstallOptions): Promise<boolean> {
  if (options.yes || !isInteractive() || isCI()) return true;
  const proceed = await clack.confirm({
    message: options.purge
      ? t("uninstall.confirmPurge")
      : t("uninstall.confirm"),
    initialValue: false,
  });
  if (clack.isCancel(proceed) || !proceed) {
    printCancelled();
    process.exitCode = clack.isCancel(proceed) ? CANCEL_EXIT_CODE : 0;
    return false;
  }
  return true;
}

/**
 * Uninstall the globally installed CLI package. Injectable `runner` / `deps`
 * for unit tests. Under VITEST, real npm uninstall is skipped unless a runner
 * is provided.
 */
export async function uninstallCommand(
  options: UninstallOptions = {},
  runnerArg?: CommandRunner | unknown,
  deps: UninstallDeps = defaultDeps,
): Promise<void> {
  try {
    const runner: CommandRunner =
      typeof runnerArg === "function"
        ? (runnerArg as CommandRunner)
        : runCommand;

    if (!(await confirmUninstall(options))) return;

    const command = findOnPath("npm");
    if (!command) {
      throw new Error(t("uninstall.noNpm"));
    }

    const env = buildPackageManagerEnv();
    const already = isPackageGloballyInstalled(
      runner,
      command,
      env,
      options.registry,
    );

    // Always best-effort: drop autostart and release Windows vendor locks
    // before npm touches the global tree (same rationale as update/install).
    console.log(t("uninstall.stopping"));
    try {
      deps.removeOsAutostart();
    } catch (err) {
      console.log(
        warn(
          t("uninstall.serviceFailed", {
            msg: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    }
    await deps.stopRuntime();
    console.log(success(t("uninstall.stopped")));

    if (!already) {
      console.log(warn(t("uninstall.notInstalled")));
    } else {
      const uninstallArgs = buildUninstallArgs(options.registry);
      console.log(t("uninstall.uninstalling", { pkg: PACKAGE_NAME }));
      console.log(
        t("uninstall.execute", {
          cmd: printableCommand("npm", uninstallArgs),
        }),
      );

      let result: CommandResult;
      if (process.env.VITEST && typeof runnerArg !== "function") {
        result = { status: 0 };
      } else {
        result = runner(command, uninstallArgs, {
          encoding: "utf-8",
          env,
          stdio: "pipe",
        });
      }

      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          (result.stderr || result.stdout || t("uninstall.npmFailed")).trim(),
        );
      }

      // Prefer npm list over PATH: this process may still be the old global bin.
      const stillThere = isPackageGloballyInstalled(
        runner,
        command,
        env,
        options.registry,
      );
      if (stillThere) {
        throw new Error(t("uninstall.verifyFailed", { pkg: PACKAGE_NAME }));
      }
      console.log(success(t("uninstall.packageDone")));
    }

    const home = deps.homeDir();
    if (options.purge) {
      if (deps.homeExists(home)) {
        console.log(t("uninstall.purging", { dir: home }));
        try {
          deps.purgeHome(home);
          console.log(success(t("uninstall.purged", { dir: home })));
        } catch (err) {
          console.log(
            warn(
              t("uninstall.purgeFailed", {
                dir: home,
                msg: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
          process.exitCode = process.exitCode || 1;
        }
      } else {
        console.log(t("uninstall.purgeSkippedMissing", { dir: home }));
      }
    } else if (deps.homeExists(home)) {
      console.log(warn(t("uninstall.dataKept", { dir: home })));
    }

    console.log(success(t("uninstall.done")));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
