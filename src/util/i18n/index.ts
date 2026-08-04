/**
 * 轻量 i18n(零新增依赖)。
 *
 * - 英文为默认/基线(en.ts);命中简体中文 locale 或手动切换时用 zh-CN.ts。
 * - locale 解析优先级:`NUWACLI_LANG` env > `~/.nuwa-cli/config.json` 的 `lang` 字段
 *   > 自动检测(`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE` 含 `zh`)> `en`。
 * - 首次 `t()` 调用时解析并缓存;`setLang(undefined)` 可强制重新解析(测试用)。
 * - `t(key, vars?)` 用 `{name}` 命名占位,无 ICU/复数(项目文案无此需求)。
 * - **ACP 协议响应不应使用 `t()`**——协议层文案恒英文(对齐 nuwaclaw/agent-kit)。
 */
import * as fs from "node:fs";
import { cliConfigPath, writeFileAtomic } from "../paths.js";
import { en } from "./en.js";
import { zhCN } from "./zh-CN.js";

export { en, zhCN };
export type Lang = "en" | "zh-CN";
export type Vars = Record<string, string | number>;

/** 临时覆盖用的环境变量名。 */
export const LANG_ENV = "NUWACLI_LANG";
const AUTO = "auto";

/**
 * 判定一个 locale 代码的中文变体。返回:
 * - "zh-CN":简体(zh / zh-CN / zh-Hans / zh_CN / zh_Hans 等)
 * - "zh-TW":繁体(zh-TW / zh-HK / zh-MO / zh-Hant 等)——本项目无繁体包
 * - null:非中文
 *
 * 关键:只有**简体**才命中 zh-CN 包;繁体(zh-TW/zh-HK/zh-Hant)不应回退到简体,
 * 而是走默认英文(本项目只提供简体中文翻译)。
 */
function classifyZh(code: string): "zh-CN" | "zh-TW" | null {
  if (!/(^|[_\-.])zh/i.test(code)) return null;
  // 繁体:script=Hant,或 region=TW/HK/MO
  if (/(hant|[_\-.]tw|[_\-.]hk|[_\-.]mo)/i.test(code)) return "zh-TW";
  return "zh-CN";
}

/**
 * 把任意用户输入(en / zh-CN / zh-Hans / auto / zh-TW ...)归一为 Lang 或 undefined。
 * 繁体中文(zh-TW/zh-HK/zh-Hant)无对应包 → undefined(回退到自动检测/默认 en)。
 */
export function normalizeLang(code?: string): Lang | undefined {
  if (!code) return undefined;
  const lc = code.trim().toLowerCase();
  if (lc === AUTO) return undefined;
  if (lc === "en" || lc.startsWith("en-") || lc.startsWith("en_")) return "en";
  // 仅简体中文命中 zh-CN;繁体(zh-TW 等)无包 → 回退
  return classifyZh(code) === "zh-CN" ? "zh-CN" : undefined;
}

/**
 * 检测系统 locale 是否为简体中文。仅看标准 POSIX 环境变量
 * (macOS/Linux 设;Windows 原生终端通常不设,用户需用 NUWACLI_LANG/config 显式指定)。
 * 繁体中文 locale 不命中(回退 en)。
 */
export function detectLocaleFromEnv(): Lang {
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (classifyZh(c) === "zh-CN") return "zh-CN";
  }
  return "en";
}

/** 读取持久化的 `lang`(~/.nuwa-cli/config.json)。容错:文件缺失/损坏 → undefined。 */
export function readLangConfig(): string | undefined {
  try {
    const raw = fs.readFileSync(cliConfigPath(), "utf-8");
    const obj = JSON.parse(raw) as { lang?: unknown };
    return typeof obj.lang === "string" ? obj.lang : undefined;
  } catch {
    return undefined;
  }
}

/** 持久化 `lang` 到 config.json(读改写,保留其它字段)。 */
export function writeLangConfig(code: string): void {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(fs.readFileSync(cliConfigPath(), "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    // 文件缺失/损坏 → 用空对象起步。
  }
  obj.lang = code;
  writeFileAtomic(cliConfigPath(), JSON.stringify(obj, null, 2) + "\n");
}

export interface ResolvedLang {
  lang: Lang;
  source: "env" | "config" | "detect" | "default";
}

/** 按优先级解析当前语言及其来源。 */
export function resolveLang(): ResolvedLang {
  const fromEnv = normalizeLang(process.env[LANG_ENV]);
  if (fromEnv) return { lang: fromEnv, source: "env" };
  const fromConfig = normalizeLang(readLangConfig());
  if (fromConfig) return { lang: fromConfig, source: "config" };
  const detected = detectLocaleFromEnv();
  if (detected === "zh-CN") return { lang: detected, source: "detect" };
  return { lang: "en", source: "default" };
}

let current: Lang | undefined; // 缓存;undefined 表示尚未解析

function activeLang(): Lang {
  if (current === undefined) current = resolveLang().lang;
  return current;
}

export function getLang(): Lang {
  return activeLang();
}

/**
 * 覆盖当前语言。传 `undefined` 清除缓存 → 下次 `t()` 重新按 env/config/detect 解析(测试用)。
 */
export function setLang(code?: Lang): void {
  current = code;
}

/**
 * 取本地化文案并替换 `{name}` 占位。key 必须存在于 en.ts(编译期检查,防 typo)。
 * 缺失时运行期回退到 key 本身。
 */
export function t<K extends keyof typeof en>(key: K, vars?: Vars): string {
  const bundle: Record<string, string> =
    activeLang() === "zh-CN" ? zhCN : en;
  let s = bundle[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
