import type { Command } from "commander";
import { uiCommand } from "../commands/ui.js";
import { addUiOptions } from "./options.js";

export function registerUiCommand(program: Command): void {
  addUiOptions(
    program
      .command("console")
      .description(
        "启动本地 Web Console：查看/续接/新建会话并直接聊天（仅前台单例）",
      ),
  ).action(uiCommand);
}
