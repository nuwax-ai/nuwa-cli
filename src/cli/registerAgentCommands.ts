import type { Command } from "commander";
import { chatCommand } from "../commands/chat.js";
import { doctorCommand } from "../commands/doctor.js";
import {
  sessionsCommand,
  sessionsSummaryCommand,
} from "../commands/sessions.js";
import { workspacesCommand } from "../commands/workspaces.js";
import { addModelOverlayOptions } from "./options.js";
import { processesCommand } from "../commands/processes.js";
import { t } from "../util/i18n/index.js";

export function registerAgentCommands(program: Command): void {
  program
    .command("ps")
    .description(t("cli.cmd.ps.desc"))
    .option("--json", t("cli.opt.jsonArray"))
    .action(processesCommand);

  program
    .command("doctor")
    .description(t("cli.cmd.doctor.desc"))
    .option("--fix", t("cli.cmd.doctor.opt.fix"))
    .action(doctorCommand);

  addModelOverlayOptions(
    program
      .command("chat")
      .description(t("cli.cmd.chat.desc"))
      .option("--engine <engine>", t("cli.cmd.enginePick"), "claude")
      .option("--cwd <dir>", t("cli.cmd.chat.opt.cwd"), process.cwd())
      .option("-p, --print <prompt>", t("cli.cmd.chat.opt.print"))
      .option("--yolo", t("cli.cmd.chat.opt.yolo"))
      .option("--mode <modeId>", t("cli.cmd.chat.opt.mode"))
      .option("--resume [sessionId]", t("cli.cmd.chat.opt.resume"))
      .option(
        "--ref-session <engine:sessionId>",
        t("cli.cmd.chat.opt.refSession"),
      )
      .option("--auto-digest", t("cli.cmd.chat.opt.autoDigest"))
      .option(
        "--handoff <engine:sessionId>",
        t("cli.cmd.chat.opt.handoff"),
      ),
  ).action(chatCommand);

  const sessions = program
    .command("sessions")
    .description(t("cli.cmd.sessions.desc"))
    .option("--engine <engine>", t("cli.opt.engineFilter"))
    .option("--search <keyword>", t("cli.cmd.sessions.opt.search"))
    .option("--days <n>", t("cli.cmd.sessions.opt.days"))
    .option("--since <iso>", t("cli.cmd.sessions.opt.since"))
    .option("--until <iso>", t("cli.cmd.sessions.opt.until"))
    .option("--limit <n>", t("cli.cmd.sessions.opt.limit"))
    .option("--verbose", t("cli.cmd.sessions.opt.verbose"))
    .option("--json", t("cli.opt.jsonArray"))
    .action(sessionsCommand);

  sessions
    .command("summary")
    .description(t("cli.cmd.sessions.summary.desc"))
    // Plain (not required) — the parent `sessions` command already declares
    // `--engine`, and commander attributes a shared flag name to whichever
    // command in the chain declares it first, so a child `requiredOption` of
    // the same name never sees the value and always fails. sessionsSummaryCommand
    // reads the merged value via `command.optsWithGlobals()` and validates it
    // itself instead of relying on commander's required-option check.
    .option("--engine <engine>", t("cli.cmd.sessions.summary.opt.engine"))
    .option("--session-id <id>", t("cli.cmd.sessions.summary.opt.sessionId"))
    .option("--limit <n>", t("cli.cmd.sessions.summary.opt.limit"))
    .option("--offset <n>", t("cli.cmd.sessions.summary.opt.offset"))
    .option("--format <format>", t("cli.cmd.sessions.summary.opt.format"))
    .option("--reverse", t("cli.cmd.sessions.summary.opt.reverse"))
    .option("--json", t("cli.opt.jsonOnly"))
    .action(sessionsSummaryCommand);

  program
    .command("workspaces")
    .description(t("cli.cmd.workspaces.desc"))
    .option("--user <id>", t("cli.cmd.workspaces.opt.user"))
    .option("--long", t("cli.cmd.workspaces.opt.long"))
    .option("--json", t("cli.opt.json"))
    .action(workspacesCommand);
}
