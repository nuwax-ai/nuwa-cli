import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateSdlcGate,
  resetSdlcGateCache,
  type SdlcGateInput,
} from "../../src/core/permissions/sdlcGate.js";

let repo: string;

function setup(cfg: object | null, opts: { git?: boolean } = { git: true }) {
  repo = mkdtempSync(join(tmpdir(), "sdlc-gate-"));
  if (opts.git) execSync("git init -q", { cwd: repo });
  if (cfg) writeFileSync(join(repo, ".sdlc.json"), JSON.stringify(cfg));
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "plans"), { recursive: true });
}

function input(over: Partial<SdlcGateInput> = {}): SdlcGateInput {
  return {
    rawInput: { file_path: join(repo, "src/a.ts") },
    sessionId: "sess-test",
    cwd: repo,
    ...over,
  };
}

const BASE_CFG = {
  name: "t",
  srcPaths: ["src/"],
  plansDirs: ["plans", "specs"],
  protectedWrite: ["docs/frozen.md"],
  envPrefix: "NUWACLAW",
};

beforeEach(() => {
  resetSdlcGateCache();
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("evaluateSdlcGate", () => {
  it("无 .sdlc.json 时 fail-open 放行", () => {
    setup(null);
    expect(evaluateSdlcGate(input())).toEqual({ decision: "pass" });
  });

  it("秘钥文件写入 → deny；example 模板 → pass", () => {
    setup(BASE_CFG);
    expect(
      evaluateSdlcGate(input({ rawInput: { file_path: join(repo, ".env") } }))
        .decision,
    ).toBe("deny");
    expect(
      evaluateSdlcGate(
        input({ rawInput: { file_path: join(repo, ".env.example") } }),
      ).decision,
    ).toBe("pass");
  });

  it("受保护路径编辑 → deny（读取不受限）", () => {
    setup(BASE_CFG);
    expect(
      evaluateSdlcGate(
        input({ rawInput: { file_path: join(repo, "docs/frozen.md") } }),
      ).decision,
    ).toBe("deny");
  });

  it("源码首改且无在途工件 → ask，并建立会话记账；同会话重试 → pass", () => {
    setup(BASE_CFG);
    const r1 = evaluateSdlcGate(input());
    expect(r1.decision).toBe("ask");
    expect(r1.reason).toContain("templates/plan.md");
    expect(evaluateSdlcGate(input()).decision).toBe("pass");
  });

  it("plans 目录有在途改动 → 直接 pass（不追问）", () => {
    setup(BASE_CFG);
    writeFileSync(join(repo, "plans", "wip.md"), "x");
    expect(evaluateSdlcGate(input()).decision).toBe("pass");
  });

  it("环境变量停用 → pass", () => {
    setup(BASE_CFG);
    process.env.NUWACLAW_SKIP_PLAN_GATE = "1";
    try {
      expect(evaluateSdlcGate(input()).decision).toBe("pass");
    } finally {
      delete process.env.NUWACLAW_SKIP_PLAN_GATE;
    }
  });

  it("非源码区路径 → pass", () => {
    setup(BASE_CFG);
    expect(
      evaluateSdlcGate(
        input({ rawInput: { file_path: join(repo, "docs/note.md") } }),
      ).decision,
    ).toBe("pass");
  });
});
