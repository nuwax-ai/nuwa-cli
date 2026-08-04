import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  ui: vi.fn(),
  credentials: vi.fn(),
  stopAll: vi.fn(),
  waitStack: vi.fn(),
}));

vi.mock("../src/commands/gateway.js", () => ({
  gatewayCommand: (...args: unknown[]) => mocks.gateway(...args),
}));

vi.mock("../src/commands/ui.js", () => ({
  uiCommand: (...args: unknown[]) => mocks.ui(...args),
}));

vi.mock("../src/core/auth/credentials.js", () => ({
  readCredentials: () => mocks.credentials(),
}));

vi.mock("../src/core/processes/lanproxyStatus.js", () => ({
  waitForGatewayStackReady: (...args: unknown[]) => mocks.waitStack(...args),
}));

describe("restartCommand", () => {
  beforeEach(() => {
    mocks.gateway.mockReset().mockResolvedValue(undefined);
    mocks.ui.mockReset().mockResolvedValue(undefined);
    mocks.credentials.mockReset().mockReturnValue({ configKey: "logged-in" });
    mocks.stopAll.mockReset().mockResolvedValue(0);
    mocks.waitStack.mockReset().mockResolvedValue({
      gateway: {
        state: "running",
        pid: 1,
        host: "127.0.0.1",
        port: 60016,
        startedAt: "2026-08-04T00:00:00.000Z",
      },
      lanproxy: {
        pid: 2,
        kind: "lanproxy",
        host: "testagent.xspaceagi.com",
        port: 10076,
      },
    });
    process.exitCode = 0;
  });

  it("restarts only Gateway as a daemon by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // stopAllNuwaProcesses 走真实实现会扫进程；这里通过 vitest 环境跳过 1s sleep 即可
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({ engine: "codex", open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      engine: "codex",
      daemon: true,
      force: true,
    });
    expect(mocks.ui).not.toHaveBeenCalled();
    expect(mocks.waitStack).toHaveBeenCalled();
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

  it("skips restart when not logged in", async () => {
    mocks.credentials.mockReturnValue({});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({});

    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("未登录 Nuwax"),
    );
    logSpy.mockRestore();
  });
});
