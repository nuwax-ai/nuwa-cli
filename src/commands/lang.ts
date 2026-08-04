import type { Command } from "commander";
import pc from "picocolors";
import {
  LANG_ENV,
  normalizeLang,
  resolveLang,
  t,
  writeLangConfig,
} from "../util/i18n/index.js";

/**
 * `nuwa-cli lang [en|zh-CN|auto]`:
 * - 无参:显示当前语言及解析来源(env > config > detect > default)。
 * - 有参:写入 `~/.nuwa-cli/config.json` 的 `lang` 字段(持久化)。`auto` = 按系统 locale 检测。
 * 临时覆盖优先用 `NUWACLI_LANG` 环境变量(它高于 config)。
 */
export function langCommand(code?: string): void {
  if (!code) {
    const { lang, source } = resolveLang();
    const sourceLabel =
      source === "env"
        ? t("lang.sourceEnv")
        : source === "config"
          ? t("lang.sourceConfig")
          : source === "detect"
            ? t("lang.sourceDetect")
            : t("lang.sourceDefault");
    console.log(t("lang.current", { lang }));
    console.log(pc.dim(t("lang.resolved", { source: sourceLabel })));
    console.log(pc.dim(t("lang.hint")));
    return;
  }
  const lc = code.trim().toLowerCase();
  if (lc !== "auto" && !normalizeLang(lc)) {
    console.error(pc.red(t("lang.badCode", { code })));
    process.exitCode = 1;
    return;
  }
  writeLangConfig(lc);
  console.log(lc === "auto" ? t("lang.setAuto") : t("lang.set", { lang: lc }));
}

export function registerLangCommand(program: Command): void {
  program
    .command("lang [code]")
    .description(
      "Show or set the UI language (en, zh-CN, auto). Overrides via " +
        `${LANG_ENV} env take precedence over this config.`,
    )
    .action((code?: string) => langCommand(code));
}
