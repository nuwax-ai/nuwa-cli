import type { Command } from "commander";
import { infoCommand } from "../commands/info.js";
import { t } from "../util/i18n/index.js";

/**
 * Top-level `info` = panoramic config + recent sessions + update hint.
 * Distinct from `status` (account/runtime only) and `sessions` (history only).
 */
export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description(t("cli.cmd.info.desc"))
    .option(
      "--limit <n>",
      t("cli.cmd.info.opt.limit"),
      (value) => Number(value),
      10,
    )
    .option("--no-sessions", t("cli.cmd.info.opt.noSessions"))
    .option("--no-update-check", t("cli.cmd.info.opt.noUpdateCheck"))
    .addHelpText("after", t("cli.cmd.info.help"))
    .action((options) =>
      infoCommand({
        limit:
          typeof options.limit === "number" && Number.isFinite(options.limit)
            ? options.limit
            : 10,
        // commander --no-sessions → sessions:false
        noSessions: options.sessions === false,
        noUpdateCheck: options.updateCheck === false,
      }),
    );
}
