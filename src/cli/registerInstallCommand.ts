import type { Command } from "commander";
import { installCommand } from "../commands/install.js";
import { t } from "../util/i18n/index.js";

/**
 * Top-level `install` = first-time product install wizard (npx entry).
 * Distinct from `service install` (OS autostart / keep-alive).
 */
export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description(t("cli.cmd.install.desc"))
    .option("--yes", t("cli.cmd.install.opt.yes"))
    .option("--lang <code>", t("cli.cmd.install.opt.lang"))
    .option("--tag <tag>", t("cli.cmd.install.opt.tag"))
    .option("--registry <url>", t("cli.cmd.install.opt.registry"))
    .option("--force", t("cli.cmd.install.opt.force"))
    .addHelpText("after", t("cli.cmd.install.help"))
    .action((options) => installCommand(options));
}
