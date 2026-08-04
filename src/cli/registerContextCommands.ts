import type { Command } from "commander";
import {
  contextDigestCommand,
  contextHandoffCommand,
  contextListCommand,
  contextReadCommand,
} from "../commands/context.js";
import { t } from "../util/i18n/index.js";

export function registerContextCommands(program: Command): void {
  const context = program
    .command("context")
    .description(t("cli.cmd.context.desc"));

  context
    .command("list")
    .description(t("cli.cmd.context.list.desc"))
    .option("--engine <engine>", t("cli.opt.engineFilter"))
    .option("--json", t("cli.opt.json"))
    .action(contextListCommand);

  context
    .command("read")
    .description(t("cli.cmd.context.read.desc"))
    .requiredOption("--ref <engine:sessionId>", t("cli.opt.ref"))
    .option("--limit <n>", t("cli.opt.limitMsgs"))
    .option("--json", t("cli.opt.jsonOnly"))
    .action(contextReadCommand);

  context
    .command("digest")
    .description(t("cli.cmd.context.digest.desc"))
    .requiredOption("--ref <engine:sessionId>", t("cli.opt.ref"))
    .option("--limit <n>", t("cli.cmd.context.digest.opt.limit"))
    .option("--json", t("cli.opt.jsonOnly"))
    .action(contextDigestCommand);

  context
    .command("handoff")
    .description(t("cli.cmd.context.handoff.desc"))
    .requiredOption("--ref <engine:sessionId>", t("cli.opt.ref"))
    .option("--limit <n>", t("cli.cmd.context.handoff.opt.limit"))
    .option("--json", t("cli.opt.jsonOnly"))
    .action(contextHandoffCommand);
}
