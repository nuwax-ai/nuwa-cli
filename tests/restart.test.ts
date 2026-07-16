import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  ui: vi.fn(),
}));

vi.mock("../src/commands/gateway.js", () => ({
  gatewayCommand: (...args: unknown[]) => mocks.gateway(...args),
}));

vi.mock("../src/commands/ui.js", () => ({
  uiCommand: (...args: unknown[]) => mocks.ui(...args),
}));

describe("restartCommand", () => {
  beforeEach(() => {
    mocks.gateway.mockReset().mockResolvedValue(undefined);
    mocks.ui.mockReset().mockResolvedValue(undefined);
    process.exitCode = 0;
  });

  it("restarts Gateway as a daemon before replacing the foreground Console", async () => {
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({ all: true, engine: "codex", open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      engine: "codex",
      daemon: true,
      force: true,
    });
    expect(mocks.ui).toHaveBeenCalledWith({
      engine: "codex",
      force: true,
      open: false,
    });
    expect(mocks.gateway.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ui.mock.invocationCallOrder[0],
    );
  });

  it("does not replace Console when Gateway restart fails", async () => {
    mocks.gateway.mockImplementation(async () => {
      process.exitCode = 1;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({ all: true });

    expect(mocks.ui).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Gateway 重启失败"),
    );
    errorSpy.mockRestore();
  });
});
