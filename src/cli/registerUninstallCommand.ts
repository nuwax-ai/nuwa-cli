import type { Command } from "commander";
import { uninstallCommand } from "../commands/uninstall.js";
import { t } from "../util/i18n/index.js";

/**
 * Top-level `uninstall` = remove the global CLI package.
 * Distinct from `service uninstall` (OS autostart / keep-alive only).
 *
 * Preferred entry: `npx @nuwax-ai/nuwa-cli@latest uninstall`
 * (fresh copy; safer than self-removing a running global install on Windows).
 * Default keeps `~/.nuwa-cli`; `--purge` deletes user data.
 */
export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description(t("cli.cmd.uninstall.desc"))
    .option("--purge", t("cli.cmd.uninstall.opt.purge"))
    .option("--yes", t("cli.cmd.uninstall.opt.yes"))
    .option("--registry <url>", t("cli.cmd.uninstall.opt.registry"))
    .addHelpText("after", t("cli.cmd.uninstall.help"))
    .action((options) =>
      uninstallCommand({
        purge: options.purge === true,
        yes: options.yes === true,
        registry: options.registry,
      }),
    );
}
