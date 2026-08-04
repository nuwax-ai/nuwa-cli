import type { Command } from "commander";
import {
  serviceInstallCommand,
  serviceStartCommand,
  serviceStatusCommand,
  serviceStopCommand,
  serviceUninstallCommand,
} from "../commands/service.js";
import { serveCommand } from "../commands/serve.js";
import { gatewayCommand } from "../commands/gateway.js";
import { stopCommand } from "../commands/processes.js";
import { restartCommand } from "../commands/restart.js";
import { startCommand } from "../commands/start.js";
import {
  addCloudLoginOptions,
  addModelOverlayOptions,
  addServeRuntimeOptions,
  addServiceInstallOptions,
} from "./options.js";
import { t } from "../util/i18n/index.js";

export function registerServiceCommands(program: Command): void {
  addModelOverlayOptions(
    addCloudLoginOptions(
      program
        .command("start")
        .description(t("cli.cmd.start.desc")),
    )
      .option("--all", t("cli.cmd.start.opt.all"))
      .option("--engine <engine>", t("cli.cmd.engineDefault"))
      .option("--cwd <dir>", t("cli.cmd.start.opt.cwd"))
      .option(
        "--approve <policy>",
        t("cli.cmd.start.opt.approve"),
        "auto",
      )
      .option("--force", t("cli.cmd.start.opt.force"))
      .option("--no-open", t("cli.cmd.start.opt.noOpen")),
  )
    .addHelpText("after", t("cli.cmd.start.help"))
    .action(startCommand);

  program
    .command("restart")
    .description(t("cli.cmd.restart.desc"))
    .option("--all", t("cli.cmd.restart.opt.all"))
    .option("--engine <engine>", t("cli.cmd.engineDefault"))
    .option("--no-open", t("cli.cmd.start.opt.noOpen"))
    .addHelpText("after", t("cli.cmd.restart.help"))
    .action(restartCommand);

  program
    .command("stop")
    .description(t("cli.cmd.stop.desc"))
    .option("--all", t("cli.cmd.stop.opt.all"))
    .option("--gateway", t("cli.cmd.stop.opt.gateway"))
    .option("--console", t("cli.cmd.stop.opt.console"))
    .addHelpText("after", t("cli.cmd.stop.help"))
    .action(stopCommand);

  addServeRuntimeOptions(
    program
      .command("serve")
      .description(t("cli.cmd.serve.desc"))
      .option("--engine <engine>", t("cli.cmd.enginePick"), "claude")
      .option("--tunnel", t("cli.cmd.serve.opt.tunnel")),
  ).action(serveCommand);

  addServeRuntimeOptions(
    addCloudLoginOptions(
      program
        .command("gateway")
        .description(t("cli.cmd.gateway.desc")),
    ).option("--engine <engine>", t("cli.cmd.gateway.opt.engine")),
  )
    .addHelpText("after", t("cli.cmd.gateway.help"))
    .action(async (options) => {
      await gatewayCommand(options);
    });

  const service = program
    .command("service")
    .description(t("cli.cmd.service.desc"));

  addServiceInstallOptions(
    service
      .command("install")
      .description(t("cli.cmd.service.install.desc")),
  )
    .addHelpText("after", t("cli.cmd.service.install.help"))
    .action(serviceInstallCommand);

  service
    .command("start")
    .description(t("cli.cmd.service.start.desc"))
    .action(serviceStartCommand);

  service
    .command("stop")
    .description(t("cli.cmd.service.stop.desc"))
    .action(serviceStopCommand);

  service
    .command("status")
    .description(t("cli.cmd.service.status.desc"))
    .action(serviceStatusCommand);

  service
    .command("uninstall")
    .description(t("cli.cmd.service.uninstall.desc"))
    .action(serviceUninstallCommand);
}
