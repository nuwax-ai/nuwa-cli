import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  ui: vi.fn(),
  credentials: vi.fn(),
  reportReady: vi.fn(),
  serviceStatus: vi.fn(),
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
  reportGatewayStackReadiness: (...args: unknown[]) =>
    mocks.reportReady(...args),
}));

vi.mock("../src/core/service/serviceManager.js", () => ({
  getServiceStatus: () => mocks.serviceStatus(),
}));

describe("restartCommand", () => {
  beforeEach(() => {
    mocks.gateway.mockReset().mockResolvedValue(undefined);
    mocks.ui.mockReset().mockResolvedValue(undefined);
    mocks.credentials.mockReset().mockReturnValue({ configKey: "logged-in" });
    mocks.reportReady.mockReset().mockResolvedValue(true);
    mocks.serviceStatus.mockReset().mockReturnValue({ installed: true });
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
    expect(mocks.reportReady).toHaveBeenCalled();
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
      expect.stringContaining("Gateway restart failed"),
    );
    errorSpy.mockRestore();
  });

  it("sets failure when stack is not ready after restart", async () => {
    mocks.reportReady.mockResolvedValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({});

    expect(mocks.ui).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("stack is not ready"),
    );
    errorSpy.mockRestore();
  });

  it("hints KeepAlive install when service is missing", async () => {
    mocks.serviceStatus.mockReturnValue({ installed: false });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({});

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("login auto-start (KeepAlive) is not installed"),
    );
    logSpy.mockRestore();
  });

  it("skips restart when not logged in", async () => {
    mocks.credentials.mockReturnValue({});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { restartCommand } = await import("../src/commands/restart.js");
    await restartCommand({});

    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Not logged in to Nuwax"),
    );
    logSpy.mockRestore();
  });
});
