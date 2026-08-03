import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOnPath: vi.fn(),
}));

vi.mock("../src/util/which.js", () => ({
  findOnPath: (...args: unknown[]) => mocks.findOnPath(...args),
}));

vi.mock("@nuwax-ai/agent-kit", () => ({
  resolveClaudeAcp: vi.fn(() => ({
    command: "/fake/node",
    args: ["/fake/claude-code-acp.js"],
  })),
}));

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: vi
    .fn()
    .mockReturnValue("/fake/claude-code-acp.js"),
}));

describe("claudeEngine.resolve", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.findOnPath.mockReset();
  });

  it("uses the Claude Agent SDK runtime when no system claude CLI exists", async () => {
    mocks.findOnPath.mockReturnValue(null);
    const { claudeEngine } = await import("../src/core/engines/claude.js");
    await expect(claudeEngine.resolve()).resolves.toEqual({
      command: "/fake/node",
      args: ["/fake/claude-code-acp.js"],
      envOverlay: {},
    });
  });

  it("prefers the user's system claude executable when available", async () => {
    mocks.findOnPath.mockReturnValue("/usr/local/bin/claude");
    const { claudeEngine } = await import("../src/core/engines/claude.js");
    await expect(claudeEngine.resolve()).resolves.toMatchObject({
      envOverlay: { CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude" },
    });
  });
});
