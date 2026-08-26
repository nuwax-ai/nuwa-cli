/**
 * Panoramic overview (`nuwa-cli info`).
 *
 * Shows read-only, redacted config + runtime status, the latest N local
 * sessions (default 10) with resume/summary hints, and an optional
 * non-blocking CLI update check. Does not print configKey / savedKey values.
 */
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import {
  listStoredAccounts,
  readCredentials,
} from "../core/auth/credentials.js";
import {
  ConsentDeniedError,
  ConsentRequiredError,
  withSensitiveAccess,
} from "../core/permissions/sensitiveAccessGate.js";
import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../core/sessions/discovery.js";
import {
  CLI_VERSION,
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
} from "../core/version.js";
import { getLang, t } from "../util/i18n/index.js";
import { nuwaCliHome } from "../util/paths.js";
import { findOnPath } from "../util/which.js";
import {
  buildPackageManagerEnv,
  buildViewArgs,
  compareSemver,
  resolvePackageManagerInvocation,
} from "./update.js";
import { printRuntimeStatus } from "./login.js";

export interface InfoOptions {
  /** Max recent sessions to list (default 10). */
  limit?: number;
  /** Skip the local sessions section. */
  noSessions?: boolean;
  /** Skip the npm view update hint. */
  noUpdateCheck?: boolean;
}

export interface InfoUpdateHint {
  current: string;
  remote?: string;
  canUpgrade: boolean;
  channel: string;
}

export interface InfoDeps {
  readCredentials: typeof readCredentials;
  listAccounts: typeof listStoredAccounts;
  printRuntime: typeof printRuntimeStatus;
  listSessions: (limit: number) => Promise<LocalSessionSummary[]>;
  checkUpdate: () => Promise<InfoUpdateHint | null>;
  homeDir: () => string;
  lang: () => string;
  version: string;
}

const DEFAULT_SESSION_LIMIT = 10;

async function defaultListSessions(limit: number): Promise<LocalSessionSummary[]> {
  return withSensitiveAccess(
    {
      kind: "session-history",
      title: "info_recent_sessions",
      rawInput: { command: `nuwa-cli info --limit ${limit}` },
    },
    () => listLocalSessions({ limit }),
  );
}

async function defaultCheckUpdate(): Promise<InfoUpdateHint | null> {
  const npm = findOnPath("npm");
  if (!npm) return null;
  const channel = DEFAULT_DIST_TAG;
  const packageSpec = `${PACKAGE_NAME}@${channel}`;
  const args = buildViewArgs(packageSpec);
  const invocation = resolvePackageManagerInvocation(npm, args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf-8",
    env: buildPackageManagerEnv(),
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) return null;
  const remote = (result.stdout || "").trim().split(/\r?\n/)[0]?.trim();
  if (!remote) return null;
  const canUpgrade = compareSemver(remote, CLI_VERSION) > 0;
  return { current: CLI_VERSION, remote, canUpgrade, channel };
}

const defaultDeps: InfoDeps = {
  readCredentials,
  listAccounts: listStoredAccounts,
  printRuntime: printRuntimeStatus,
  listSessions: defaultListSessions,
  checkUpdate: defaultCheckUpdate,
  homeDir: () => nuwaCliHome(),
  lang: () => getLang(),
  version: CLI_VERSION,
};

function printSection(title: string): void {
  console.log("");
  console.log(pc.bold(title));
}

/**
 * Print panoramic config + recent sessions + optional update hint.
 * Injectable `deps` for unit tests.
 */
export async function infoCommand(
  options: InfoOptions = {},
  deps: InfoDeps = defaultDeps,
): Promise<void> {
  const limit = Math.max(1, options.limit ?? DEFAULT_SESSION_LIMIT);
  const unset = t("config.stateUnset");
  const creds = deps.readCredentials();
  const accounts = deps.listAccounts(creds);
  const loggedIn = Boolean(creds.configKey);

  printSection(t("info.section.config"));
  console.log(t("info.version", { version: deps.version }));
  console.log(t("info.lang", { lang: deps.lang() }));
  console.log(t("info.home", { dir: deps.homeDir() }));
  console.log(
    t("info.login", {
      state: loggedIn
        ? pc.green(t("info.loginYes"))
        : pc.dim(t("info.loginNo")),
    }),
  );
  console.log(t("config.domain", { value: creds.domain ?? unset }));
  console.log(t("config.username", { value: creds.username ?? unset }));
  console.log(
    t("config.computerName", { value: creds.computerName ?? unset }),
  );
  console.log(t("config.accounts", { n: accounts.length }));
  // Never print secret values — only set/unset.
  console.log(
    t("config.savedKey", {
      state: creds.savedKey ? t("config.stateSet") : unset,
    }),
  );
  console.log(
    t("info.configKey", {
      state: creds.configKey ? t("config.stateSet") : unset,
    }),
  );
  console.log(
    t("config.lanproxyPath", {
      value: creds.lanproxyPath ?? unset,
    }),
  );

  printSection(t("info.section.runtime"));
  await deps.printRuntime();

  if (!options.noSessions) {
    printSection(t("info.section.sessions", { n: limit }));
    try {
      const sessions = await deps.listSessions(limit);
      if (sessions.length === 0) {
        console.log(pc.dim(t("sessions.empty")));
      } else {
        for (const s of sessions) {
          const when = s.updatedAt.slice(0, 16).replace("T", " ");
          console.log(
            `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(when)}  ${s.title}`,
          );
          console.log(`       ${pc.dim(s.sessionId)}  ${pc.dim(s.cwd)}`);
          console.log(
            pc.dim(
              t("info.sessionHint", {
                engine: s.engine,
                id: s.sessionId,
              }),
            ),
          );
        }
        console.log(pc.dim(t("info.sessionsMore")));
      }
    } catch (err) {
      if (
        err instanceof ConsentRequiredError ||
        err instanceof ConsentDeniedError
      ) {
        console.error(pc.red(`[nuwa-cli] ${err.message}`));
        process.exitCode = process.exitCode || 1;
      } else {
        console.log(
          warnLine(
            t("info.sessionsFailed", {
              msg: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      }
    }
  }

  if (!options.noUpdateCheck) {
    printSection(t("info.section.update"));
    try {
      const hint = await deps.checkUpdate();
      if (!hint) {
        console.log(pc.dim(t("info.updateCheckSkipped")));
      } else if (hint.canUpgrade && hint.remote) {
        console.log(
          t("info.updateAvailable", {
            from: hint.current,
            to: hint.remote,
            channel: hint.channel,
          }),
        );
        console.log(pc.dim(t("info.updateHint")));
      } else {
        console.log(
          t("info.updateCurrent", {
            version: hint.current,
            channel: hint.channel,
          }),
        );
      }
    } catch {
      console.log(pc.dim(t("info.updateCheckSkipped")));
    }
  }

  console.log("");
}

function warnLine(msg: string): string {
  return pc.yellow(msg);
}
