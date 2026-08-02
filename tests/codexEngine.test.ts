import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

// codex 引擎定位已抽进 @nuwax-ai/agent-kit；这里 mock 它返回一个 fake 入口，
// 只验证 codex.ts 正确消费 agent-kit 的结果 + 叠加宿主特有的 CODEX_LOG_DIR。
vi.mock("@nuwax-ai/agent-kit", () => ({
  resolveCodexAcp: vi.fn(() => ({
    command: "/fake/node",
    args: ["/fake/nuwax-codex-acp.js"],
  })),
}));

describe("codexEngine.resolve", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-codex-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Re-import both the engine and the (mocked) agent-kit fresh after
  // resetModules so each test observes its own mock call history.
  async function load() {
    const { codexEngine } = await import("../src/core/engines/codex.js");
    const { resolveCodexAcp } = await import("@nuwax-ai/agent-kit");
    return { codexEngine, resolveCodexAcp };
  }

  it("consumes @nuwax-ai/agent-kit.resolveCodexAcp for the adapter entry", async () => {
    const { codexEngine, resolveCodexAcp } = await load();
    const resolved = await codexEngine.resolve();
    expect(resolveCodexAcp).toHaveBeenCalledTimes(1);
    // command/args are passed through from agent-kit (envOverlay stays empty
    // there — host-specific env is layered on below).
    expect(resolved.command).toBe("/fake/node");
    expect(resolved.args).toEqual(["/fake/nuwax-codex-acp.js"]);
  });

  it("points the adapter log dir at codexLogDir() so engine-start failures are captured", async () => {
    const { codexEngine } = await load();
    const resolved = await codexEngine.resolve();
    expect(resolved.envOverlay?.CODEX_LOG_DIR).toBeTruthy();
  });

  it("respects an explicit CODEX_LOG_DIR / APP_SERVER_LOGS override", async () => {
    const { codexEngine } = await load();
    const prev = process.env.CODEX_LOG_DIR;
    process.env.CODEX_LOG_DIR = "/custom/log/dir";
    try {
      const resolved = await codexEngine.resolve();
      expect(resolved.envOverlay?.CODEX_LOG_DIR).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CODEX_LOG_DIR;
      else process.env.CODEX_LOG_DIR = prev;
    }
  });
});
