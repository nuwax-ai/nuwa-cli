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

export function registerAgentCommands(program: Command): void {
  program
    .command("ps")
    .description("列出运行中的 Gateway、Console 和 chat 进程")
    .option("--json", "以 JSON 数组格式输出")
    .action(processesCommand);

  program
    .command("doctor")
    .description(
      "检测环境、登录态、会话历史以及 Gateway/Console 单例状态",
    )
    .option(
      "--fix",
      "自动修复 Gateway/Console 多实例，各自仅保留一个有效实例",
    )
    .action(doctorCommand);

  addModelOverlayOptions(
    program
      .command("chat")
      .description("与本机已登录的 claude/codex 对话（复用其登录态与本地配置）")
      .option("--engine <engine>", "使用的引擎：claude 或 codex", "claude")
      .option("--cwd <dir>", "工作目录", process.cwd())
      .option("-p, --print <prompt>", "单次输出模式：发送一条 prompt 并退出")
      .option("--yolo", "自动批准所有工具调用（危险，谨慎使用）")
      .option(
        "--mode <modeId>",
        "设置引擎会话模式（如 acceptEdits/bypassPermissions，因引擎而异）",
      )
      .option(
        "--resume [sessionId]",
        "续接本地历史会话；不带 id 时弹出交互选择列表",
      )
      .option(
        "--ref-session <engine:sessionId>",
        "关联另一个引擎的历史会话作为上下文（如 claude:xxxx）；不是真续接，" +
          "只在首轮提醒模型按需运行 `sessions summary` 查看",
      )
      .option(
        "--auto-digest",
        "与 --ref-session 连用时自动读取摘要并注入首轮（默认只提示模型自行查询）",
      )
      .option(
        "--handoff <engine:sessionId>",
        "从另一个本地会话生成结构化交接包，并在新 ACP 会话首轮注入",
      ),
  ).action(chatCommand);

  const sessions = program
    .command("sessions")
    .description("列出本地 claude/codex 会话历史")
    .option("--engine <engine>", "只看某个引擎：claude 或 codex")
    .option("--search <keyword>", "按标题、sessionId 或路径模糊搜索")
    .option("--days <n>", "只看最近 N 天的会话")
    .option("--since <iso>", "只看此日期之后的会话（ISO 格式，如 2026-07-01）")
    .option("--until <iso>", "只看此日期之前的会话")
    .option("--limit <n>", "最多返回 N 个会话")
    .option("--verbose", "显示更详细的信息")
    .option("--json", "以 JSON 数组格式输出")
    .action(sessionsCommand);

  sessions
    .command("summary")
    .description(
      "输出某个本地会话的紧凑 JSON 摘要（供 agent 按需读取另一引擎的历史，见 chat --ref-session）",
    )
    // Plain (not required) — the parent `sessions` command already declares
    // `--engine`, and commander attributes a shared flag name to whichever
    // command in the chain declares it first, so a child `requiredOption` of
    // the same name never sees the value and always fails. sessionsSummaryCommand
    // reads the merged value via `command.optsWithGlobals()` and validates it
    // itself instead of relying on commander's required-option check.
    .option("--engine <engine>", "会话所属引擎：claude 或 codex")
    .option("--session-id <id>", "会话 ID")
    .option("--limit <n>", "只返回最近 N 条消息")
    .option("--offset <n>", "跳过前 N 条消息（与 --limit 配合分页）")
    .option("--format <format>", "输出格式：json（默认）或 jsonl")
    .option("--reverse", "按时间逆序输出（新消息在前）")
    .option("--json", "以 JSON 输出（当前是唯一输出格式）")
    .action(sessionsSummaryCommand);

  program
    .command("workspaces")
    .description(
      "列出本地工作空间目录（云端会话生成的文件，~/.nuwa-cli/workspaces）",
    )
    .option("--user <id>", "只看某个用户 ID 下的项目")
    .option("--long", "列出每个项目内的文件树")
    .option("--json", "以 JSON 格式输出")
    .action(workspacesCommand);
}
