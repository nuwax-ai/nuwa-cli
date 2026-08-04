import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

// 把 nuwa-cli 的家目录指向临时目录,使 config.json 的读写不污染真实环境。
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const ENV_KEYS = ["NUWACLI_LANG", "LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-i18n-test-"));
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("normalizeLang", () => {
  it("把各种输入归一为 en / zh-CN / undefined(auto)", async () => {
    const { normalizeLang } = await import("../src/util/i18n/index.js");
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("en_US.UTF-8")).toBe("en");
    expect(normalizeLang("zh")).toBe("zh-CN");
    expect(normalizeLang("zh-CN")).toBe("zh-CN");
    expect(normalizeLang("zh_Hans")).toBe("zh-CN");
    expect(normalizeLang("zh_Hans_CN")).toBe("zh-CN");
    // 繁体中文无对应包 → 回退(不映射到简体)
    expect(normalizeLang("zh-TW")).toBeUndefined();
    expect(normalizeLang("zh-HK")).toBeUndefined();
    expect(normalizeLang("zh-Hant")).toBeUndefined();
    expect(normalizeLang("auto")).toBeUndefined();
    expect(normalizeLang("fr")).toBeUndefined();
    expect(normalizeLang(undefined)).toBeUndefined();
  });
});

describe("detectLocaleFromEnv", () => {
  it("LC_ALL/LC_MESSAGES/LANG/LANGUAGE 含 zh → zh-CN", async () => {
    const { detectLocaleFromEnv } = await import("../src/util/i18n/index.js");
    process.env.LC_ALL = "zh_CN.UTF-8";
    expect(detectLocaleFromEnv()).toBe("zh-CN");
    delete process.env.LC_ALL;
    process.env.LANGUAGE = "zh:en";
    expect(detectLocaleFromEnv()).toBe("zh-CN");
    delete process.env.LANGUAGE;
    process.env.LANG = "zh_Hans_CN";
    expect(detectLocaleFromEnv()).toBe("zh-CN");
  });

  it("无 zh 相关 env → en", async () => {
    const { detectLocaleFromEnv } = await import("../src/util/i18n/index.js");
    process.env.LANG = "en_US.UTF-8";
    expect(detectLocaleFromEnv()).toBe("en");
  });

  it("繁体中文 locale(zh-TW/zh-Hant)不命中简体 → en", async () => {
    const { detectLocaleFromEnv } = await import("../src/util/i18n/index.js");
    process.env.LANG = "zh_TW.UTF-8";
    expect(detectLocaleFromEnv()).toBe("en");
    delete process.env.LANG;
    process.env.LC_ALL = "zh-Hant";
    expect(detectLocaleFromEnv()).toBe("en");
  });
});

describe("resolveLang 优先级", () => {
  it("NUWACLI_LANG env 最高(覆盖 config 与检测)", async () => {
    const { resolveLang, writeLangConfig } = await import(
      "../src/util/i18n/index.js"
    );
    writeLangConfig("zh-CN");
    process.env.LANG = "zh_CN.UTF-8";
    process.env.NUWACLI_LANG = "en";
    expect(resolveLang()).toEqual({ lang: "en", source: "env" });
  });

  it("无 env 时 config 次之", async () => {
    const { resolveLang, writeLangConfig } = await import(
      "../src/util/i18n/index.js"
    );
    writeLangConfig("zh-CN");
    process.env.LANG = "en_US.UTF-8";
    expect(resolveLang()).toEqual({ lang: "zh-CN", source: "config" });
  });

  it("config=auto 落到检测", async () => {
    const { resolveLang, writeLangConfig } = await import(
      "../src/util/i18n/index.js"
    );
    writeLangConfig("auto");
    process.env.LANG = "zh_CN.UTF-8";
    expect(resolveLang()).toEqual({ lang: "zh-CN", source: "detect" });
  });

  it("无 env 无有效 config,L=zh → detect", async () => {
    const { resolveLang } = await import("../src/util/i18n/index.js");
    process.env.LANG = "zh_CN.UTF-8";
    expect(resolveLang()).toEqual({ lang: "zh-CN", source: "detect" });
  });

  it("什么都没有 → en/default", async () => {
    const { resolveLang } = await import("../src/util/i18n/index.js");
    expect(resolveLang()).toEqual({ lang: "en", source: "default" });
  });
});

describe("t()", () => {
  it("默认英文 + 占位替换", async () => {
    const { t, setLang } = await import("../src/util/i18n/index.js");
    setLang("en");
    expect(t("common.cancelled")).toBe("Cancelled.");
    expect(t("common.shuttingDown", { signal: "SIGINT" })).toBe(
      "\n[nuwa-cli] received SIGINT, shutting down...",
    );
  });

  it("setLang(zh-CN) 切中文", async () => {
    const { t, setLang } = await import("../src/util/i18n/index.js");
    setLang("zh-CN");
    expect(t("common.cancelled")).toBe("已取消。");
    expect(t("common.shuttingDown", { signal: "SIGINT" })).toBe(
      "\n[nuwa-cli] 收到 SIGINT，正在关闭...",
    );
    setLang("en");
  });

  it("未知 key 回退到 key 本身", async () => {
    const { t, setLang } = await import("../src/util/i18n/index.js");
    setLang("en");
    // 运行期用任意字符串调用(绕过编译期 key 检查)
    expect((t as (k: string) => string)("no.such.key")).toBe("no.such.key");
  });
});

describe("en / zh-CN key 一致性", () => {
  it("两份 bundle 拥有完全相同的 key 集合", async () => {
    const { en, zhCN } = await import("../src/util/i18n/index.js");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });
});

describe("lang config 持久化", () => {
  it("writeLangConfig / readLangConfig 往返", async () => {
    const { writeLangConfig, readLangConfig } = await import(
      "../src/util/i18n/index.js"
    );
    expect(readLangConfig()).toBeUndefined();
    writeLangConfig("zh-CN");
    expect(readLangConfig()).toBe("zh-CN");
    writeLangConfig("auto");
    expect(readLangConfig()).toBe("auto");
  });

  it("writeLangConfig 保留 config.json 其它字段", async () => {
    const { writeLangConfig, readLangConfig } = await import(
      "../src/util/i18n/index.js"
    );
    const { cliConfigPath } = await import("../src/util/paths.js");
    fs.mkdirSync(path.dirname(cliConfigPath()), { recursive: true });
    fs.writeFileSync(
      cliConfigPath(),
      JSON.stringify({ other: "kept", n: 42 }),
    );
    writeLangConfig("en");
    const obj = JSON.parse(fs.readFileSync(cliConfigPath(), "utf-8"));
    expect(obj).toMatchObject({ other: "kept", n: 42, lang: "en" });
    expect(readLangConfig()).toBe("en");
  });
});
