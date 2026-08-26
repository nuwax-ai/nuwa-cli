import type { Command } from "commander";
import { updateCommand } from "../commands/update.js";
import { t } from "../util/i18n/index.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [version]")
    .description(t("cli.cmd.update.desc"))
    .option("--check", t("cli.cmd.update.opt.check"))
    .option("--dry-run", t("cli.cmd.update.opt.dryRun"))
    .option("--registry <url>", t("cli.cmd.update.opt.registry"))
    .option("--force", t("cli.cmd.update.opt.force"))
    .option("--yes", t("cli.cmd.update.opt.yes"))
    .addHelpText("after", t("cli.cmd.update.help"))
    .action((version, options) => updateCommand(version, options));
}
