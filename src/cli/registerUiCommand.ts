import type { Command } from "commander";
import { uiCommand } from "../commands/ui.js";
import { addUiOptions } from "./options.js";
import { t } from "../util/i18n/index.js";

export function registerUiCommand(program: Command): void {
  addUiOptions(
    program.command("console").description(t("cli.cmd.console.desc")),
  ).action(uiCommand);
}
