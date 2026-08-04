import type { Command } from "commander";
import {
  accountListCommand,
  accountSwitchCommand,
} from "../commands/account.js";
import { configGetCommand, configSetCommand } from "../commands/config.js";
import {
  loginCommand,
  logoutCommand,
  statusCommand,
} from "../commands/login.js";
import { addCloudLoginHelp, addCloudLoginOptions } from "./options.js";
import { t } from "../util/i18n/index.js";

export function registerCloudCommands(program: Command): void {
  addCloudLoginHelp(
    addCloudLoginOptions(
      program.command("login").description(t("cli.cmd.login.desc")),
    ),
  ).action(loginCommand);

  program
    .command("logout")
    .description(t("cli.cmd.logout.desc"))
    .action(logoutCommand);

  program
    .command("status")
    .description(t("cli.cmd.status.desc"))
    .option("--remote", t("cli.cmd.status.opt.remote"))
    .action(statusCommand);

  const config = program
    .command("config")
    .description(t("cli.cmd.config.desc"));

  config
    .command("get [key]")
    .description(t("cli.cmd.config.get.desc"))
    .action(configGetCommand);

  config
    .command("set <key> <value>")
    .description(t("cli.cmd.config.set.desc"))
    .action(configSetCommand);

  const account = program
    .command("account")
    .description(t("cli.cmd.account.desc"));

  account
    .command("list")
    .description(t("cli.cmd.account.list.desc"))
    .action(accountListCommand);

  account
    .command("switch <account>")
    .description(t("cli.cmd.account.switch.desc"))
    .addHelpText("after", t("cli.cmd.account.switch.help"))
    .action(accountSwitchCommand);
}
