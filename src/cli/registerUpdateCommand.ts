import type { Command } from "commander";
import { updateCommand } from "../commands/update.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [version]")
    .description("升级 nuwa-cli CLI（当前默认跟随 beta 通道）")
    .option("--check", "只查询目标版本，不执行安装")
    .option("--dry-run", "打印升级命令但不执行")
    .option("--registry <url>", "指定 npm registry")
    .addHelpText(
      "after",
      [
        "",
        "示例：",
        "  nuwa-cli update",
        "  nuwa-cli update 0.1.0-beta.2",
        "  nuwa-cli update latest",
        "  nuwa-cli update --check",
        "",
        "说明：",
        "  - update 使用 npm 升级全局 CLI 包，不修改 ~/.nuwa-cli 登录数据。",
        "  - 当前预发布阶段默认跟随 beta；可显式指定版本或 latest tag。",
        "  - npx 临时运行时，建议直接使用 npx -y @nuwax-ai/nuwa-cli@beta ...。",
      ].join("\n"),
    )
    .action((version, options) => updateCommand(version, options));
}
