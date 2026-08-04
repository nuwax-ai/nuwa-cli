import { Command } from "commander";
import { CLI_VERSION } from "../core/version.js";
import { registerAgentCommands } from "./registerAgentCommands.js";
import { registerCloudCommands } from "./registerCloudCommands.js";
import { registerContextCommands } from "./registerContextCommands.js";
import { registerServiceCommands } from "./registerServiceCommands.js";
import { registerUpdateCommand } from "./registerUpdateCommand.js";
import { registerUiCommand } from "./registerUiCommand.js";
import { registerLangCommand } from "../commands/lang.js";
import { t } from "../util/i18n/index.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("nuwa-cli")
    .description(t("cli.description"))
    .version(CLI_VERSION);

  registerAgentCommands(program);
  registerContextCommands(program);
  registerCloudCommands(program);
  registerServiceCommands(program);
  registerUiCommand(program);
  registerUpdateCommand(program);
  registerLangCommand(program);

  return program;
}
