import type { Command } from "commander";
import {
  skillInstallCommand,
  skillLinkCommand,
  skillListCommand,
  skillUpdateCommand,
} from "../commands/skill.js";
import { t } from "../util/i18n/index.js";

/**
 * `nuwa-cli skill` — 技能套件本地管理（安装=下载+挂链，list=安装位与链状态）。
 * 安装逻辑单一事实源：skills/scripts/install-skill.sh（S3 公开读，零凭证）。
 */
export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description(t("cli.cmd.skill.desc"));

  skill
    .command("install")
    .description(t("cli.cmd.skill.install.desc"))
    .argument("[name]", t("cli.cmd.skill.opt.name"))
    .option("--version <v>", t("cli.cmd.skill.opt.version"))
    .option("--target <dir>", t("cli.cmd.skill.opt.target"))
    .option("--force", t("cli.cmd.skill.opt.force"))
    .option("--no-bundle", t("cli.cmd.skill.opt.noBundle"))
    .option("--no-link", t("cli.cmd.skill.opt.noLink"))
    .action((name, options) =>
      skillInstallCommand({
        name,
        version: options.version,
        target: options.target,
        force: options.force,
        noBundle: options.noBundle,
        noLink: options.noLink,
      }),
    );

  skill
    .command("update")
    .description(t("cli.cmd.skill.update.desc"))
    .argument("[name]", t("cli.cmd.skill.opt.name"))
    .option("--version <v>", t("cli.cmd.skill.opt.version"))
    .option("--target <dir>", t("cli.cmd.skill.opt.target"))
    .option("--force", t("cli.cmd.skill.opt.force"))
    .action((name, options) =>
      skillUpdateCommand({
        name,
        version: options.version,
        target: options.target,
        force: options.force,
      }),
    );

  skill
    .command("link")
    .description(t("cli.cmd.skill.link.desc"))
    .argument("[name]", t("cli.cmd.skill.opt.name"))
    .action((name) => skillLinkCommand({ name }));

  skill
    .command("list")
    .description(t("cli.cmd.skill.list.desc"))
    .action(() => skillListCommand());
}
