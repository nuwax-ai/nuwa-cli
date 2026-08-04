import type { Command } from "commander";
import { CLI_AGENT_PORT, CLI_UI_PORT } from "../core/ports.js";
import { t } from "../util/i18n/index.js";

export function addCloudLoginOptions(command: Command): Command {
  return command
    .option("--domain <host>", t("cli.login.opt.domain"))
    .option("--saved-key <key>", t("cli.login.opt.savedKey"))
    .option("-u, --username <username>", t("cli.login.opt.username"));
}

export function addCloudLoginHelp(command: Command): Command {
  return command.addHelpText("after", t("cli.login.help.block"));
}

export function addModelOverlayOptions(command: Command): Command {
  return command
    .option("--api-key <key>", t("cli.opt.apiKey"))
    .option("--base-url <url>", t("cli.opt.baseUrl"))
    .option("--model <model>", t("cli.opt.model"));
}

export function addUiOptions(command: Command): Command {
  return addModelOverlayOptions(
    command
      .option(
        "--port <port>",
        t("cli.ui.opt.port"),
        String(CLI_UI_PORT),
      )
      .option("--host <host>", t("cli.ui.opt.host"), "127.0.0.1")
      .option(
        "--engine <engine>",
        t("cli.ui.opt.engine"),
        "claude",
      )
      .option("--cwd <dir>", t("cli.ui.opt.cwd"))
      .option(
        "--approve <policy>",
        t("cli.ui.opt.approve"),
        "auto",
      )
      .option("--force", t("cli.ui.opt.force"))
      .option("--no-open", t("cli.ui.opt.noOpen")),
  );
}

export function addServeRuntimeOptions(command: Command): Command {
  return addModelOverlayOptions(
    command
      .option(
        "--port <port>",
        t("cli.serve.opt.port"),
        String(CLI_AGENT_PORT),
      )
      .option("--host <host>", t("cli.serve.opt.host"), "127.0.0.1")
      .option("--cwd <dir>", t("cli.serve.opt.cwd"))
      .option(
        "--approve <policy>",
        t("cli.serve.opt.approve"),
        "auto",
      )
      .option(
        "--lanproxy-path <path>",
        t("cli.serve.opt.lanproxyPath"),
      )
      .option(
        "--lanproxy-host <host>",
        t("cli.serve.opt.lanproxyHost"),
      )
      .option(
        "--lanproxy-port <port>",
        t("cli.serve.opt.lanproxyPort"),
      )
      .option(
        "--lanproxy-ssl <true|false>",
        t("cli.serve.opt.lanproxySsl"),
        "true",
      )
      .option("--daemon", t("cli.serve.opt.daemon"))
      .option("--force", t("cli.serve.opt.force")),
  );
}

export function addServiceInstallOptions(command: Command): Command {
  return command
    .option("--engine <engine>", t("cli.service.opt.engine"))
    .option(
      "--port <port>",
      t("cli.serve.opt.port"),
      String(CLI_AGENT_PORT),
    )
    .option("--host <host>", t("cli.serve.opt.host"), "127.0.0.1")
    .option("--cwd <dir>", t("cli.serve.opt.cwd"))
    .option(
      "--approve <policy>",
      t("cli.serve.opt.approve"),
      "auto",
    )
    .option(
      "--lanproxy-path <path>",
      t("cli.serve.opt.lanproxyPath"),
    )
    .option(
      "--lanproxy-host <host>",
      t("cli.serve.opt.lanproxyHost"),
    )
    .option(
      "--lanproxy-port <port>",
      t("cli.serve.opt.lanproxyPort"),
    )
    .option(
      "--lanproxy-ssl <true|false>",
      t("cli.serve.opt.lanproxySsl"),
      "true",
    )
    .option("--now", t("cli.service.opt.now"));
}
