import type { Command } from "commander";
import { uiCommand } from "../commands/ui.js";
import { addUiOptions } from "./options.js";

export function registerUiCommand(program: Command): void {
  addUiOptions(
    program
      .command("ui")
      .description(
        "启动本地轻量 Web 控制台：查看/续接/新建 claude·codex 会话，切换引擎/模型/ACP 模式并直接聊天",
      ),
  ).action(uiCommand);
}
