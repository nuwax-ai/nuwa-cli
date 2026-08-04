import pc from "picocolors";
import type { Command } from "commander";
import { t } from "../util/i18n/index.js";
import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../core/sessions/discovery.js";
import { parseTranscript } from "../core/sessions/transcript.js";
import {
  ConsentDeniedError,
  ConsentRequiredError,
  withSensitiveAccess,
} from "../core/permissions/sensitiveAccessGate.js";

export interface SessionsCommandOptions {
  engine?: string;
  search?: string;
  days?: string;
  since?: string;
  until?: string;
  limit?: string;
  verbose?: boolean;
  json?: boolean;
}

function handleGateError(err: unknown): void {
  if (err instanceof ConsentRequiredError || err instanceof ConsentDeniedError) {
    console.error(pc.red(`[nuwa-cli] ${err.message}`));
    process.exitCode = 1;
    return;
  }
  throw err;
}

export async function sessionsCommand(
  options: SessionsCommandOptions,
): Promise<void> {
  const engine =
    options.engine === "claude" || options.engine === "codex"
      ? options.engine
      : undefined;

  let sessions: LocalSessionSummary[];
  try {
    sessions = await withSensitiveAccess(
      {
        kind: "session-history",
        title: "local_sessions_list",
        rawInput: {
          command: `nuwa-cli sessions${engine ? ` --engine ${engine}` : ""}`,
        },
      },
      () =>
        listLocalSessions({
          engine,
          search: options.search,
          sinceDays: options.days ? Number(options.days) : undefined,
          since: options.since,
          until: options.until,
          limit: options.limit ? Number(options.limit) : undefined,
        }),
    );
  } catch (err) {
    handleGateError(err);
    return;
  }

  if (sessions.length === 0) {
    if (options.search) {
      console.log(pc.dim(t("sessions.searchEmpty", { search: options.search })));
    } else {
      console.log(pc.dim(t("sessions.empty")));
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (options.verbose) {
    for (const s of sessions) {
      console.log(
        `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
      );
      console.log(`       ${pc.dim(s.sessionId)}`);
      console.log(`       ${pc.dim(s.cwd)}`);
    }
  } else {
    for (const s of sessions) {
      console.log(
        `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
      );
      console.log(`       ${pc.dim(s.sessionId)}  ${pc.dim(s.cwd)}`);
    }
  }

  console.log(
    pc.dim(t("sessions.summary.tail", { n: sessions.length })),
  );
}

export interface SessionsSummaryCommandOptions {
  engine?: string;
  sessionId?: string;
  limit?: string;
  offset?: string;
  format?: string;
  reverse?: boolean;
}

/**
 * Prints a compact, engine-agnostic JSON digest of one local session's full
 * transcript. Meant to be invoked by an *agent's own shell tool* (not a
 * human) — gated by sensitive-access when non-TTY.
 */
export async function sessionsSummaryCommand(
  _options: SessionsSummaryCommandOptions,
  command: Command,
): Promise<void> {
  const merged = command.optsWithGlobals() as SessionsSummaryCommandOptions;
  const engine =
    merged.engine === "claude" || merged.engine === "codex"
      ? merged.engine
      : undefined;
  if (!engine) {
    console.error(pc.red(t("common.engineMustBeClaudeOrCodex")));
    process.exitCode = 1;
    return;
  }

  const sessionId = merged.sessionId;
  if (!sessionId) {
    console.error(pc.red(t("sessions.summary.missingSessionId")));
    process.exitCode = 1;
    return;
  }

  try {
    await withSensitiveAccess(
      {
        kind: "session-history",
        title: "local_sessions_read",
        rawInput: {
          command: `nuwa-cli sessions summary --engine ${engine} --session-id ${sessionId}`,
        },
      },
      async () => {
        const sessions = await listLocalSessions(engine);
        const match = sessions.find((s) => s.sessionId === sessionId);
        if (!match) {
          console.error(
            pc.red(
              t("sessions.summary.notFound", { engine, id: sessionId }),
            ),
          );
          process.exitCode = 1;
          return;
        }

        const limit = merged.limit ? Number(merged.limit) : undefined;
        const offset = merged.offset ? Number(merged.offset) : undefined;

        const { messages, hasMore } = await parseTranscript(
          engine,
          match.filePath,
          {
            limit,
            offset,
            order: merged.reverse ? "desc" : "asc",
          },
        );

        if (merged.format === "jsonl") {
          for (const msg of messages) {
            console.log(JSON.stringify({ engine, sessionId, ...msg }));
          }
          return;
        }

        console.log(
          JSON.stringify({
            engine,
            sessionId: match.sessionId,
            cwd: match.cwd,
            title: match.title,
            messages,
            hasMore,
          }),
        );
      },
    );
  } catch (err) {
    handleGateError(err);
  }
}
