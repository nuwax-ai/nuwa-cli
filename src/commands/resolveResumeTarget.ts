import * as clack from "@clack/prompts";
import pc from "picocolors";
import { printCancelled } from "../util/ui.js";
import { t } from "../util/i18n/index.js";
import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../core/sessions/discovery.js";
import type { EngineKind } from "../core/env/inheritEnv.js";
import { withSensitiveAccess } from "../core/permissions/sensitiveAccessGate.js";

export interface ResumeTarget {
  sessionId: string;
  cwd: string;
}

/**
 * Resolves what to resume *before* the engine process is spawned — this only
 * touches local session-history files, so a cancelled picker costs nothing.
 *
 * `resumeOption` is commander's optional-value convention: `true` means
 * `--resume` was passed with no id (show a picker), a string is an explicit
 * id, `undefined` means resume wasn't requested at all.
 */
export async function resolveResumeTarget(
  resumeOption: true | string | undefined,
  engine: EngineKind,
): Promise<ResumeTarget | null> {
  if (!resumeOption) return null;

  // resume 是用户主动续接：purpose=user-resume，敏感闸门直接放行
  const sessions = await withSensitiveAccess(
    {
      kind: "session-history",
      title: "local_sessions_list",
      purpose: "user-resume",
    },
    () => listLocalSessions(engine),
  );

  if (typeof resumeOption === "string") {
    // Try exact match first
    let match = sessions.find((s) => s.sessionId === resumeOption);
    // Fall back to prefix match
    if (!match) {
      const prefixMatches = sessions.filter((s) =>
        s.sessionId.startsWith(resumeOption),
      );
      if (prefixMatches.length === 1) {
        match = prefixMatches[0];
      } else if (prefixMatches.length > 1) {
        const picked = await clack.select({
          message: t("resolve.multipleSelect", { option: resumeOption }),
          options: prefixMatches.map((s: LocalSessionSummary) => ({
            value: s.sessionId,
            label: `${s.title}`,
            hint: `${s.engine} · ${s.updatedAt.slice(0, 16).replace("T", " ")} · ${s.cwd}`,
          })),
        });
        if (clack.isCancel(picked)) {
          printCancelled();
          process.exit(0);
          return null;
        }
        match = sessions.find((s) => s.sessionId === picked)!;
      }
    }
    if (!match) {
      throw new Error(
        t("resolve.notFoundId", { id: resumeOption, engine }),
      );
    }
    return { sessionId: match.sessionId, cwd: match.cwd };
  }

  if (sessions.length === 0) {
    throw new Error(t("resolve.noHistory", { engine }));
  }

  const picked = await clack.autocomplete({
    message: t("resolve.autocompleteMessage"),
    placeholder: t("resolve.autocompletePlaceholder"),
    options: sessions.map((s: LocalSessionSummary) => ({
      value: s.sessionId,
      label: `${s.title}`,
      hint: `${s.engine} · ${s.updatedAt.slice(0, 16).replace("T", " ")} · ${s.cwd}`,
    })),
  });

  if (clack.isCancel(picked)) {
    printCancelled();
    process.exit(0);
    return null; // unreachable in production (exit() halts the process); keeps control flow correct if exit is ever intercepted (e.g. tests).
  }

  const match = sessions.find((s) => s.sessionId === picked)!;
  return { sessionId: match.sessionId, cwd: match.cwd };
}
