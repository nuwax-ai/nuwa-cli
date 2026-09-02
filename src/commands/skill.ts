/**
 * `nuwa-cli skill <install|update|link|list>` — nuwa-cli 技能套件的本地管理。
 *
 * 安装逻辑单一事实源是 `skills/scripts/install-skill.sh`（S3 定版 → sha256 校验 →
 * 原子落盘 → 挂链本机 agent 技能目录）；本命令层只做参数组装、脚本定位与
 * 已装状态的可读呈现，不重复实现下载/校验/挂链。
 *
 * 与 onboarding（nuwa-browser 桌面端）的 AGENT_DIRS 同清单：五目录覆盖六引擎
 * （~/.claude/skills ← Claude Code+OpenCode 兼容读；~/.agents/skills ← OpenCode
 * 官方全局路径 + Gemini CLI 官方别名；codex/cursor/zcode 各自专属）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { t } from "../util/i18n/index.js";

export const AGENT_SKILL_DIRS = [
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".zcode/skills",
  ".agents/skills",
] as const;

export const DEFAULT_SKILL_STORE = ".nuwa-cli/skills";
const INSTALL_SCRIPT = "install-skill.sh";

/** 定位打包内/开发布局下的 skills/scripts 目录。 */
export function resolveSkillScriptDir(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): string | null {
  // 开发布局：<repo>/src/commands → 向上找 skills/scripts/install-skill.sh
  let dir = startDir;
  for (let i = 0; i < 8 && dirname(dir) !== dir; i++) {
    const candidate = join(dir, "skills", "scripts", INSTALL_SCRIPT);
    if (existsSync(candidate)) return dirname(candidate);
    dir = dirname(dir);
  }
  // 打包布局：<pkgRoot>/dist/cli.js 与 <pkgRoot>/skills/scripts 并列
  // （package.json files 含 "skills/scripts"）；startDir 通常是 dist/ 或 dist/../。
  const packaged = join(dirname(startDir), "skills", "scripts");
  return existsSync(join(packaged, INSTALL_SCRIPT)) ? packaged : null;
}

export interface SkillInstallOptions {
  name?: string;
  version?: string;
  target?: string;
  force?: boolean;
  noBundle?: boolean;
  noLink?: boolean;
  linkOnly?: boolean;
}

/** install-skill.sh 参数组装（纯函数，测试用）。 */
export function buildSkillScriptArgs(opts: SkillInstallOptions): string[] {
  const args: string[] = [];
  if (opts.name) args.push(opts.name);
  if (opts.version) args.push("--version", opts.version);
  if (opts.target) args.push("--target", opts.target);
  if (opts.force) args.push("--force");
  if (opts.noBundle) args.push("--no-bundle");
  if (opts.noLink) args.push("--no-link");
  if (opts.linkOnly) args.push("--link-only");
  return args;
}

/** 执行 install-skill.sh（stdio 直通，退出码透传）。 */
export function runSkillScript(
  opts: SkillInstallOptions,
  scriptDir: string | null = resolveSkillScriptDir(),
): void {
  if (!scriptDir) {
    console.error(pc.red(t("skill.scriptMissing")));
    process.exitCode = 1;
    return;
  }
  const args = buildSkillScriptArgs(opts);
  const r = spawnSync("bash", [join(scriptDir, INSTALL_SCRIPT), ...args], {
    stdio: "inherit",
  });
  if (r.error) {
    console.error(pc.red(t("skill.scriptSpawnFailed", { error: String(r.error) })));
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.status ?? 1;
}

export type LinkState = "linked" | "dir" | "none" | "missing-root";

export interface InstalledSkill {
  name: string;
  /** .installed 版本戳（安装器写入）。 */
  installedVersion: string | null;
  /** SKILL.md frontmatter metadata.version。 */
  fmVersion: string | null;
  links: Record<string, LinkState>;
}

function readFrontmatterVersion(skillDir: string): string | null {
  try {
    const text = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    const v = m?.[1].match(/^  version: "([^"]+)"/m);
    return v?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 扫描安装目录 + 五目录链状态（纯读取，测试可注入 homeDir 与临时目录）。 */
export function listInstalledSkills(
  homeDir: string = process.env.HOME || process.env.USERPROFILE || "",
  storeRel: string = process.env.NUWAX_SKILLS_DIR || DEFAULT_SKILL_STORE,
): InstalledSkill[] {
  const store = storeRel.startsWith("/") ? storeRel : join(homeDir, storeRel);
  if (!existsSync(store)) return [];
  const out: InstalledSkill[] = [];
  for (const name of readdirSync(store).sort()) {
    const skillDir = join(store, name);
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    let installedVersion: string | null = null;
    try {
      installedVersion = readFileSync(join(skillDir, ".installed"), "utf-8").trim() || null;
    } catch {
      // 无版本戳（手工放入等）— 保留 null
    }
    const links: Record<string, LinkState> = {};
    for (const rel of AGENT_SKILL_DIRS) {
      const dest = join(homeDir, rel, name);
      if (!existsSync(join(homeDir, rel))) {
        links[rel] = "missing-root";
      } else {
        let st;
        try {
          st = lstatSync(dest);
        } catch {
          st = null;
        }
        links[rel] = st?.isSymbolicLink() ? "linked" : st ? "dir" : "none";
      }
    }
    out.push({ name, installedVersion, fmVersion: readFrontmatterVersion(skillDir), links });
  }
  return out;
}

export function skillListCommand(): void {
  const skills = listInstalledSkills();
  if (skills.length === 0) {
    console.log(t("skill.list.empty"));
    return;
  }
  console.log(pc.bold(t("skill.list.header")));
  for (const s of skills) {
    const ver = s.installedVersion ?? s.fmVersion ?? "?";
    const linkedCount = Object.values(s.links).filter((v) => v === "linked").length;
    console.log(`  ${pc.cyan(s.name)}  v${ver}  ${t("skill.list.linkedCount", { n: linkedCount })}`);
    for (const [rel, state] of Object.entries(s.links)) {
      const mark =
        state === "linked" ? pc.green("✓")
        : state === "dir" ? pc.yellow("!")
        : state === "missing-root" ? pc.dim("–")
        : pc.red("✗");
      const hint = state === "dir" ? t("skill.list.dirHint") : state === "missing-root" ? t("skill.list.missingRootHint") : state === "none" ? t("skill.list.noneHint") : "";
      console.log(`    ${mark} ~/${rel}/${s.name}${hint ? pc.dim("  " + hint) : ""}`);
    }
  }
}

export function skillInstallCommand(opts: SkillInstallOptions): void {
  runSkillScript(opts);
}

export function skillUpdateCommand(opts: SkillInstallOptions): void {
  // install-skill.sh 自带「同版本已装跳过」；update = 重跑安装（含挂链刷新）。
  runSkillScript({ ...opts, force: opts.force ?? false });
}

export function skillLinkCommand(opts: { name?: string }): void {
  runSkillScript({ name: opts.name, linkOnly: true });
}
