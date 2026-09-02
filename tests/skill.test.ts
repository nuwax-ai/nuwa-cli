import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_SKILL_DIRS,
  buildSkillScriptArgs,
  listInstalledSkills,
  resolveSkillScriptDir,
} from "../src/commands/skill.js";

describe("skill command", () => {
  it("buildSkillScriptArgs 组装 install-skill.sh 参数", () => {
    expect(buildSkillScriptArgs({})).toEqual([]);
    expect(buildSkillScriptArgs({ name: "nuwax-platform-access", noBundle: true })).toEqual([
      "nuwax-platform-access",
      "--no-bundle",
    ]);
    expect(
      buildSkillScriptArgs({ name: "x", version: "1.2.3", target: "/tmp/s", force: true, noLink: true }),
    ).toEqual(["x", "--version", "1.2.3", "--target", "/tmp/s", "--force", "--no-link"]);
    expect(buildSkillScriptArgs({ linkOnly: true })).toEqual(["--link-only"]);
  });

  it("resolveSkillScriptDir 在开发布局下找到 skills/scripts", () => {
    // vitest 运行于 <repo>，从 repo 根显式探测；dist 布局由 files 字段保证
    expect(resolveSkillScriptDir(process.cwd())).toMatch(/skills\/scripts$/);
    expect(existsSync(join(resolveSkillScriptDir(process.cwd())!, "install-skill.sh"))).toBe(true);
  });

  it("listInstalledSkills 报告已装版本与五目录链状态", () => {
    const home = join(tmpdir(), `nuwa-skill-test-${Date.now()}`);
    const store = join(home, ".nuwa-cli", "skills");
    const skillDir = join(store, "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), '---\nname: demo-skill\ndescription: d\nmetadata:\n  version: "1.0.0"\n---\nbody\n');
    writeFileSync(join(skillDir, ".installed"), "1.0.0\n");

    // 三个 agent 根：一个挂链、一个真实目录、一个缺根
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    symlinkSync(skillDir, join(home, ".claude", "skills", "demo-skill"));
    mkdirSync(join(home, ".codex", "skills", "demo-skill"), { recursive: true }); // 真实目录，不接管

    const skills = listInstalledSkills(home);
    expect(skills).toHaveLength(1);
    const s = skills[0];
    expect(s.name).toBe("demo-skill");
    expect(s.installedVersion).toBe("1.0.0");
    expect(s.fmVersion).toBe("1.0.0");
    expect(s.links[".claude/skills"]).toBe("linked");
    expect(s.links[".codex/skills"]).toBe("dir");
    expect(s.links[".cursor/skills"]).toBe("missing-root");

    // 空目录 / 无 store
    const emptyHome = join(tmpdir(), `nuwa-skill-test-empty-${Date.now()}`);
    expect(listInstalledSkills(emptyHome)).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });

  it("AGENT_SKILL_DIRS 覆盖五目录（六引擎）", () => {
    expect([...AGENT_SKILL_DIRS]).toEqual([
      ".claude/skills",
      ".codex/skills",
      ".cursor/skills",
      ".zcode/skills",
      ".agents/skills",
    ]);
  });
});
