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

  it("restarts only Gateway as a daemon by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({ engine: "codex", open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      engine: "codex",
      daemon: true,
      force: true,
    });
    expect(mocks.ui).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("nuwa-cli restart --all"),
    );
    logSpy.mockRestore();
  });

  it("restarts Gateway then Console when --all is set", async () => {
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

  it("does not replace Console when Gateway restart fails with --all", async () => {
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
