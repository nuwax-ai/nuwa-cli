import type { Command } from "commander";
import { installCommand } from "../commands/install.js";
import { t } from "../util/i18n/index.js";

/**
 * Top-level `install` = first-time product install wizard (npx entry).
 * Distinct from `service install` (OS autostart / keep-alive).
 *
 * Product split: new install → this command; upgrade → `nuwa-cli update`.
 * S3 scripts call `install --yes --bootstrap` after a fresh tarball install.
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
    .option("--no-start", t("cli.cmd.install.opt.noStart"))
    .option("--bootstrap", t("cli.cmd.install.opt.bootstrap"))
    .addHelpText("after", t("cli.cmd.install.help"))
    .action((options) =>
      installCommand({
        yes: options.yes,
        lang: options.lang,
        tag: options.tag,
        registry: options.registry,
        force: options.force,
        // commander maps --no-start → start:false; normalize to noStart.
        // --no-start wins over --bootstrap (package-only, no login/start).
        noStart: options.start === false,
        bootstrap: options.bootstrap === true,
      }),
    );
}
