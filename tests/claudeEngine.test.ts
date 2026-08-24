import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOnPath: vi.fn(),
  // Host-agnostic stand-in for the win32 rule: .cmd/.bat are not bare-spawnable.
  isDirectlySpawnable: vi.fn(
    (command: string) => !/\.(cmd|bat)$/i.test(command),
  ),
}));

vi.mock("../src/util/which.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/which.js")>();
  return {
    ...actual,
    findOnPath: (...args: unknown[]) => mocks.findOnPath(...args),
    isDirectlySpawnable: (command: string) =>
      mocks.isDirectlySpawnable(command),
  };
});

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
    mocks.isDirectlySpawnable.mockReset();
    mocks.isDirectlySpawnable.mockImplementation(
      (command: string) => !/\.(cmd|bat)$/i.test(command),
    );
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

  it("skips Windows npm .CMD shims that cannot be bare-spawned", async () => {
    mocks.findOnPath.mockReturnValue(
      "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.CMD",
    );
    const { claudeEngine } = await import("../src/core/engines/claude.js");
    await expect(claudeEngine.resolve()).resolves.toEqual({
      command: "/fake/node",
      args: ["/fake/claude-code-acp.js"],
      envOverlay: {},
    });
  });
});
