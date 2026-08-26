/**
 * First-time install wizard (`nuwa-cli install`).
 *
 * Typical entry: `npx @nuwax-ai/nuwa-cli@latest install`
 * - New install: npm install -g, then login / start (bootstrap).
 * - Already installed: prefer `nuwa-cli update` (stop/locks/incremental +
 *   logged-in restart). `--force` overlays via `updateCommand(..., { force })`.
 * - `--bootstrap`: skip packaging; only run login / start (S3 new-install tail).
 * Upgrade for everyday users stays on `nuwa-cli update`.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import {
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
  resolveNpmChannelAlias,
} from "../core/version.js";
import {
  collectRunningRuntimeSnapshot,
  hasRunningRuntimeProcesses,
  stopRuntimeProcessesForUpdate,
} from "../core/processes/upgradeStop.js";
import { findOnPath } from "../util/which.js";
import {
  CANCEL_EXIT_CODE,
  isCI,
  isInteractive,
  printCancelled,
  success,
  warn,
} from "../util/ui.js";
import {
  normalizeLang,
  resolveLang,
  setLang,
  t,
  writeLangConfig,
  type Lang,
} from "../util/i18n/index.js";
import {
  buildInstallArgs,
  buildPackageManagerEnv,
  resolvePackageManagerInvocation,
  updateCommand,
  type CommandResult,
  type CommandRunner,
} from "./update.js";
import { readCredentials } from "../core/auth/credentials.js";
import { loginCommand } from "./login.js";
import { startCommand } from "./start.js";

export interface InstallOptions {
  /** Skip confirmations; stop services if any; skip language select unless --lang. */
  yes?: boolean;
  /** Persist UI language (`en` | `zh-CN`) — written only after install proceeds. */
  lang?: string;
  /** npm dist-tag or semver (default: DEFAULT_DIST_TAG from build). */
  tag?: string;
  registry?: string;
  /** Reinstall even when the package is already globally installed. */
  force?: boolean;
  /**
   * Only install the global package; do not continue into login / start.
   * Default false — wizard runs through until Gateway is ready.
   * Wins over `--bootstrap` when both are set.
   */
  noStart?: boolean;
  /**
   * Skip npm install -g; assume the package is already on PATH and only run
   * login / start. Used by S3 new-install scripts after tarball install.
   */
  bootstrap?: boolean;
}

/**
 * Injectable hooks for post-install bootstrap (unit tests). Production uses
 * real `loginCommand` / `startCommand` / `readCredentials`.
 */
export interface InstallBootstrapDeps {
  readCredentials: typeof readCredentials;
  loginCommand: typeof loginCommand;
  startCommand: typeof startCommand;
}

/** Injectable update entry for --force overlay (unit tests). */
export type InstallUpdateFn = typeof updateCommand;

const defaultBootstrapDeps: InstallBootstrapDeps = {
  readCredentials,
  loginCommand,
  startCommand,
};

function formatLoginAccountLabel(creds: {
  username?: string;
  computerName?: string;
  domain?: string;
}): string {
  const who = creds.username || creds.computerName || "?";
  const where = creds.domain || "?";
  return `${who} @ ${where}`;
}

/** Allowed npm dist-tags for --tag (plus any semver). */
const DIST_TAGS = new Set(["latest", "beta"]);

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

function resolveNpmCommand(): string | null {
  return findOnPath("npm");
}

function printableCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function isSemverTag(value: string): boolean {
  // Accept x.y.z, optional -prerelease / +build (npm install -g pkg@…).
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    value,
  );
}

/**
 * Normalize install tag: explicit `--tag`, else build-time DEFAULT_DIST_TAG
 * (stable builds → latest, pre-release → beta). Accepts `latest` / `beta` /
 * `stable` (alias → latest) / semver.
 */
export function normalizeInstallTag(tag?: string): string {
  const raw = (tag || DEFAULT_DIST_TAG).trim();
  if (!raw || raw.startsWith("-")) {
    throw new Error(t("install.emptyTag"));
  }
  const stripped =
    raw.startsWith("v") && /^\d/.test(raw.slice(1)) ? raw.slice(1) : raw;
  const { target } = resolveNpmChannelAlias(stripped);
  if (DIST_TAGS.has(target) || isSemverTag(target)) return target;
  throw new Error(t("install.badTag", { tag: raw }));
}

/**
 * Detect whether `@nuwax-ai/nuwa-cli` is already present in the npm global
 * prefix. Prefer `npm list -g`; fall back to `npm prefix -g` + bin path.
 * Avoid bare `which nuwa-cli` — that can hit unrelated PATH entries and is
 * unreliable under `npx` (cache ≠ global install).
 */
export function isPackageGloballyInstalled(
  runner: CommandRunner,
  command: string,
  env: NodeJS.ProcessEnv,
  registry?: string,
): boolean {
  const listArgs = ["list", "-g", "--depth=0", PACKAGE_NAME];
  if (registry) listArgs.push("--registry", registry);
  const listed = runner(command, listArgs, {
    encoding: "utf-8",
    env,
    stdio: "pipe",
  });
  if (
    listed.status === 0 &&
    (listed.stdout || "").includes(PACKAGE_NAME)
  ) {
    return true;
  }

  const prefixResult = runner(command, ["prefix", "-g"], {
    encoding: "utf-8",
    env,
    stdio: "pipe",
  });
  if (prefixResult.status !== 0) return false;
  const prefix = (prefixResult.stdout || "").trim();
  if (!prefix) return false;
  const candidates =
    process.platform === "win32"
      ? [
          path.join(prefix, "nuwa-cli.cmd"),
          path.join(prefix, "nuwa-cli"),
          path.join(prefix, "bin", "nuwa-cli.cmd"),
          path.join(prefix, "bin", "nuwa-cli"),
        ]
      : [path.join(prefix, "bin", "nuwa-cli")];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/**
 * Resolve UI language for this run without writing config yet.
 * Returns the lang to persist after the user commits to installing, or
 * `undefined` when we should leave config untouched (--yes / CI / non-TTY
 * without explicit --lang).
 */
async function resolveLangForInstall(
  options: InstallOptions,
): Promise<Lang | undefined | null> {
  // null = cancelled / invalid
  if (options.lang) {
    const lc = normalizeLang(options.lang);
    if (!lc) {
      console.error(t("install.badLang", { code: options.lang }));
      process.exitCode = 1;
      return null;
    }
    // Apply for this process so subsequent prompts use the chosen language.
    setLang(lc);
    return lc;
  }

  if (options.yes || !isInteractive() || isCI()) {
    return undefined;
  }

  const initial = resolveLang().lang;
  const picked = await clack.select({
    message: t("install.prompt.lang"),
    options: [
      { value: "en" as Lang, label: "English" },
      { value: "zh-CN" as Lang, label: "简体中文" },
    ],
    initialValue: initial,
  });
  if (clack.isCancel(picked)) {
    printCancelled();
    process.exitCode = CANCEL_EXIT_CODE;
    return null;
  }
  setLang(picked);
  return picked;
}

async function confirmStopIfNeeded(options: InstallOptions): Promise<boolean> {
  const running = collectRunningRuntimeSnapshot();
  if (!hasRunningRuntimeProcesses(running)) return true;

  // --yes / CI / non-TTY: stop without asking (same as update).
  if (options.yes || !isInteractive() || isCI()) {
    return true;
  }

  const ok = await clack.confirm({
    message: t("install.confirmStopServices"),
  });
  if (clack.isCancel(ok) || !ok) {
    printCancelled(t("install.stopDeclined"));
    process.exitCode = clack.isCancel(ok) ? CANCEL_EXIT_CODE : 1;
    return false;
  }
  return true;
}

/**
 * After a successful global install: login (or skip if already logged in) then
 * `start` until Gateway is ready. Kept separate so tests can inject deps.
 *
 * Upgrade paths must NOT call this after `restartServeIfLoggedIn` — start
 * reuses a healthy Gateway stack and does not --force-kill a just-restarted
 * instance, but double invocation is still wasted work.
 */
export async function bootstrapAfterInstall(
  options: InstallOptions,
  deps: InstallBootstrapDeps = defaultBootstrapDeps,
): Promise<void> {
  const creds = deps.readCredentials();
  const loggedIn = Boolean(creds.configKey);
  const interactive = isInteractive() && !isCI() && !options.yes;

  if (loggedIn) {
    // Ask whether to skip re-login; --yes / CI / non-TTY default to skip.
    let skipLogin = true;
    if (interactive) {
      const skip = await clack.confirm({
        message: t("install.skipLoginConfirm", {
          account: formatLoginAccountLabel(creds),
        }),
        initialValue: true,
      });
      if (clack.isCancel(skip)) {
        printCancelled();
        process.exitCode = CANCEL_EXIT_CODE;
        return;
      }
      skipLogin = Boolean(skip);
    }
    if (!skipLogin) {
      console.log(t("install.loggingIn"));
      await deps.loginCommand({});
      if (!deps.readCredentials().configKey) {
        console.log(warn(t("install.loginCancelledHint")));
        process.exitCode = process.exitCode || 1;
        return;
      }
    }
  } else if (!interactive) {
    // Non-interactive / --yes cannot collect credentials; leave package
    // installed and tell the operator how to finish.
    console.log(warn(t("install.loginRequiredHint")));
    process.exitCode = process.exitCode || 1;
    return;
  } else {
    // Interactive + not logged in: startCommand will prompt login itself.
    // We still call start below so login + gateway stay one path.
  }

  console.log(t("install.starting"));
  await deps.startCommand({});
  if (process.exitCode && process.exitCode !== 0) {
    console.log(warn(t("install.startFailedHint")));
    return;
  }
  if (!deps.readCredentials().configKey) {
    // start may have returned early after cancelled login without setting exit.
    console.log(warn(t("install.loginCancelledHint")));
    process.exitCode = process.exitCode || 1;
    return;
  }
  console.log(success(t("install.ready")));
}

async function finishAfterPackage(
  options: InstallOptions,
  bootstrapDeps?: InstallBootstrapDeps,
): Promise<void> {
  if (options.noStart) {
    console.log(t("install.nextSteps"));
    return;
  }

  // Under Vitest, skip real login/start unless the test injects deps.
  if (process.env.VITEST && !bootstrapDeps) {
    console.log(t("install.nextSteps"));
    return;
  }

  await bootstrapAfterInstall(options, bootstrapDeps ?? defaultBootstrapDeps);
}

/**
 * First-time install wizard. Injectable `runner` for unit tests (npm list /
 * install). Under VITEST, real npm install is skipped unless a runner is given.
 * Optional `bootstrapDeps` / `updateFn` inject login/start/update for tests.
 */
export async function installCommand(
  options: InstallOptions = {},
  runnerArg?: CommandRunner | unknown,
  bootstrapDeps?: InstallBootstrapDeps,
  updateFn: InstallUpdateFn = updateCommand,
): Promise<void> {
  try {
    const runner: CommandRunner =
      typeof runnerArg === "function"
        ? (runnerArg as CommandRunner)
        : runCommand;

    // Language is chosen early (for prompt locale) but persisted only after
    // the user commits to a real install — avoids rewriting config on
    // “already installed → prefer update” exits.
    const langToPersist = await resolveLangForInstall(options);
    if (langToPersist === null) return;

    // --bootstrap: package already on PATH (e.g. S3 tarball just installed).
    // Skip "already installed?" / npm i -g; only run login / start.
    if (options.bootstrap) {
      if (langToPersist) {
        writeLangConfig(langToPersist);
        console.log(t("install.langSet", { lang: langToPersist }));
      }
      console.log(t("install.bootstrapOnly"));
      await finishAfterPackage(options, bootstrapDeps);
      return;
    }

    const command = resolveNpmCommand();
    if (!command) {
      throw new Error(t("install.noNpm"));
    }

    const tag = normalizeInstallTag(options.tag);
    const packageSpec = `${PACKAGE_NAME}@${tag}`;
    const env = buildPackageManagerEnv();
    const installArgs = buildInstallArgs(packageSpec, options.registry);

    const already = isPackageGloballyInstalled(
      runner,
      command,
      env,
      options.registry,
    );
    // --yes only skips confirms; reinstall still requires --force so CI/Agent
    // loops do not silently rewrite the global tree every time.
    if (already && !options.force) {
      if (isInteractive() && !isCI() && !options.yes) {
        const proceed = await clack.confirm({
          message: t("install.alreadyInstalledConfirm"),
          initialValue: false,
        });
        if (clack.isCancel(proceed) || !proceed) {
          console.log(warn(t("install.alreadyInstalledHint")));
          process.exitCode = clack.isCancel(proceed) ? CANCEL_EXIT_CODE : 0;
          return;
        }
      } else {
        console.log(warn(t("install.alreadyInstalledHint")));
        process.exitCode = 0;
        return;
      }
    }

    // Overlay reinstall: reuse update kernel (stop/locks/incremental|full +
    // logged-in restart). Then bootstrap for login/start when needed.
    // update already restarts when logged in — startCommand will reuse the
    // healthy stack rather than force-killing it.
    if (already && options.force) {
      if (langToPersist) {
        writeLangConfig(langToPersist);
        console.log(t("install.langSet", { lang: langToPersist }));
      }
      console.log(t("install.forceViaUpdate"));
      const skipRealUpdate =
        Boolean(process.env.VITEST) &&
        typeof runnerArg !== "function" &&
        updateFn === updateCommand;
      if (!skipRealUpdate) {
        await updateFn(
          tag,
          {
            force: true,
            yes: options.yes === true || !isInteractive() || isCI(),
            registry: options.registry,
          },
          typeof runnerArg === "function" ? runner : undefined,
        );
        if (process.exitCode && process.exitCode !== 0) return;
      }
      console.log(success(t("install.done")));
      await finishAfterPackage(options, bootstrapDeps);
      return;
    }

    if (!(await confirmStopIfNeeded(options))) return;

    // Commit language only once install is going to proceed.
    if (langToPersist) {
      writeLangConfig(langToPersist);
      console.log(t("install.langSet", { lang: langToPersist }));
    }

    const running = collectRunningRuntimeSnapshot();
    if (hasRunningRuntimeProcesses(running)) {
      console.log(t("install.stopping"));
      await stopRuntimeProcessesForUpdate();
      console.log(success(t("install.stopped")));
    } else {
      // Still run stop for orphan / Windows lock cleanup, but skip noisy copy.
      await stopRuntimeProcessesForUpdate();
    }

    console.log(t("install.installing", { spec: packageSpec }));
    console.log(t("install.execute", { cmd: printableCommand("npm", installArgs) }));

    // Under Vitest without an injectable runner that actually installs, avoid
    // spawning a real global npm install against the developer machine.
    let result: CommandResult;
    if (process.env.VITEST && typeof runnerArg !== "function") {
      result = { status: 0 };
    } else if (typeof runnerArg === "function") {
      result = runner(command, installArgs, {
        encoding: "utf-8",
        env,
        stdio: "pipe",
      });
    } else {
      result = await runInstallWithProgress(command, installArgs, env);
    }

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || t("install.failed")).trim(),
      );
    }

    console.log(success(t("install.done")));
    await finishAfterPackage(options, bootstrapDeps);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
