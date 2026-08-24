import { describe, it, expect, vi } from "vitest";

// claude.ts resolves the user's CLI via which.sync("claude"). Mock the `which`
// package so each case controls what findOnPath returns.
const whichMocks = vi.hoisted(() => ({
  claudePath: undefined as string | undefined,
}));
vi.mock("which", () => ({
  default: {
    sync: (cmd: string) => {
      if (cmd === "claude" && whichMocks.claudePath) return whichMocks.claudePath;
      throw new Error("not found");
    },
  },
}));

const { claudeEngine } = await import("../src/core/engines/claude.js");

describe("claude engine resolve — CLAUDE_CODE_EXECUTABLE guard", () => {
  it("passes the CLI through when it is directly spawnable (.exe)", async () => {
    whichMocks.claudePath = "C:\\tools\\claude.exe";
    const r = await claudeEngine.resolve();
    expect(r.envOverlay).toEqual({
      CLAUDE_CODE_EXECUTABLE: "C:\\tools\\claude.exe",
    });
  });

  it.skipIf(process.platform !== "win32")(
    "drops the npm .CMD shim — the adapter spawns it bare (spawn EINVAL → ACP Internal error)",
    async () => {
      whichMocks.claudePath =
        "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.CMD";
      const r = await claudeEngine.resolve();
      // Falls back to the claude-agent-sdk bundled runtime: no overlay.
      expect(r.envOverlay).toEqual({});
    },
  );

  it("omits the overlay entirely when no claude is on PATH", async () => {
    whichMocks.claudePath = undefined;
    const r = await claudeEngine.resolve();
    expect(r.envOverlay).toEqual({});
  });
});
