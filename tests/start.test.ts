import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  ui: vi.fn(),
  findGateway: vi.fn(),
  findConsole: vi.fn(),
  records: vi.fn(),
  credentials: vi.fn(),
  login: vi.fn(),
  waitStack: vi.fn(),
}));

vi.mock("../src/core/processes/lanproxyStatus.js", () => ({
  waitForGatewayStackReady: (...args: unknown[]) => mocks.waitStack(...args),
  waitForLanproxyProcess: vi.fn(),
  findLanproxyProcesses: vi.fn(() => []),
  GATEWAY_STACK_READY_TIMEOUT_MS: 30_000,
}));

vi.mock("../src/core/auth/credentials.js", () => ({
  readCredentials: () => mocks.credentials(),
}));

vi.mock("../src/commands/login.js", () => ({
  loginCommand: (...args: unknown[]) => mocks.login(...args),
}));

vi.mock("../src/commands/gateway.js", () => ({
  gatewayCommand: (...args: unknown[]) => mocks.gateway(...args),
}));

vi.mock("../src/commands/ui.js", () => ({
  uiCommand: (...args: unknown[]) => mocks.ui(...args),
}));

vi.mock("../src/core/processes/serveSingleton.js", () => ({
  findServeProcessIds: () => mocks.findGateway(),
}));

vi.mock("../src/core/processes/uiSingleton.js", () => ({
  findUiProcessIds: () => mocks.findConsole(),
}));

vi.mock("../src/core/processes/processRegistry.js", () => ({
  listRegisteredProcesses: () => mocks.records(),
}));

describe("startCommand", () => {
  beforeEach(() => {
    mocks.gateway.mockReset().mockResolvedValue("codex");
    mocks.ui.mockReset().mockResolvedValue(undefined);
    mocks.findGateway.mockReset().mockReturnValue([]);
    mocks.findConsole.mockReset().mockReturnValue([]);
    mocks.records.mockReset().mockReturnValue([]);
    mocks.credentials.mockReset().mockReturnValue({ configKey: "logged-in" });
    mocks.login.mockReset().mockResolvedValue(undefined);
    mocks.waitStack.mockReset().mockResolvedValue({
      gateway: {
        state: "running",
        pid: 101,
        host: "127.0.0.1",
        port: 60016,
        startedAt: "2026-07-16T00:00:00.000Z",
      },
      lanproxy: {
        pid: 303,
        kind: "lanproxy",
        host: "agent.nuwax.com",
        port: 443,
      },
    });
    process.exitCode = 0;
  });

  it("guides an unauthenticated user through login before starting Gateway", async () => {
    mocks.credentials
      .mockReturnValueOnce({})
      .mockReturnValue({ configKey: "fresh-login" });
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ domain: "example.com", username: "alice" });

    expect(mocks.login).toHaveBeenCalledWith({
      domain: "example.com",
      username: "alice",
      savedKey: undefined,
    });
    expect(mocks.login.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.gateway.mock.invocationCallOrder[0],
    );
    expect(mocks.gateway).toHaveBeenCalled();
    expect(mocks.gateway).toHaveBeenCalledWith(
      expect.objectContaining({ authReady: true }),
    );
    // 默认不含 Console
    expect(mocks.ui).not.toHaveBeenCalled();
    expect(mocks.waitStack).toHaveBeenCalled();
  });

  it("does not start services when login is cancelled or fails", async () => {
    mocks.credentials.mockReturnValue({});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({});

    expect(mocks.login).toHaveBeenCalled();
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.ui).not.toHaveBeenCalled();
  });

  it("starts only Gateway as a daemon by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");
    await startCommand({ engine: "codex", open: false, approve: "ask" });

    expect(mocks.gateway).toHaveBeenCalledWith({
      engine: "codex",
      approve: "ask",
      daemon: true,
      force: false,
    });
    expect(mocks.ui).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("nuwa-cli start --all"),
    );
    logSpy.mockRestore();
  });

  it("starts Gateway then foreground Console when --all is set", async () => {
    const { startCommand } = await import("../src/commands/start.js");
    await startCommand({
      all: true,
      engine: "codex",
      open: false,
      approve: "ask",
    });

    expect(mocks.gateway).toHaveBeenCalledWith({
      engine: "codex",
      approve: "ask",
      daemon: true,
      force: false,
    });
    expect(mocks.ui).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        approve: "ask",
        force: false,
        open: false,
      }),
    );
    expect(mocks.gateway.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ui.mock.invocationCallOrder[0],
    );
  });

  it("reuses healthy Gateway without starting Console by default", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.findConsole.mockReturnValue([202]);
    mocks.records.mockReturnValue([
      { pid: 101, kind: "serve", engine: "claude" },
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({});

    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.ui).not.toHaveBeenCalled();
    // 复用路径用完整就绪超时，避免开机自启 tunnel 未完成时误 force
    expect(mocks.waitStack).toHaveBeenCalledWith(30_000);
  });

  it("waits full readiness window before force-replacing a KeepAlive gateway missing lanproxy", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.waitStack.mockResolvedValue({
      gateway: {
        state: "running",
        pid: 101,
        host: "127.0.0.1",
        port: 60016,
        startedAt: "2026-08-04T00:00:00.000Z",
      },
      lanproxy: undefined,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({});

    expect(mocks.waitStack).toHaveBeenCalledWith(30_000);
    expect(mocks.gateway).toHaveBeenCalledWith(
      expect.objectContaining({ daemon: true, force: true }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("等待超时后子服务"),
    );
    logSpy.mockRestore();
  });

  it("with --all reuses healthy Gateway and Console instances", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.findConsole.mockReturnValue([202]);
    mocks.records.mockReturnValue([
      { pid: 101, kind: "serve", engine: "claude" },
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ all: true });

    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.ui).not.toHaveBeenCalled();
  });

  it("forces Gateway replacement by default without Console", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.findConsole.mockReturnValue([202]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ force: true, open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      daemon: true,
      force: true,
    });
    expect(mocks.ui).not.toHaveBeenCalled();
  });

  it("forces replacement of both services with --all --force", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.findConsole.mockReturnValue([202]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ all: true, force: true, open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      daemon: true,
      force: true,
    });
    expect(mocks.ui).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, open: false }),
    );
  });

  it("does not start Console when Gateway fails even with --all", async () => {
    mocks.gateway.mockImplementation(async () => {
      process.exitCode = 1;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ all: true });

    expect(mocks.ui).not.toHaveBeenCalled();
  });

  it("waits for gateway stack readiness after daemon start", async () => {
    mocks.waitStack.mockResolvedValue({
      gateway: { state: "stopped" },
      lanproxy: undefined,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({});

    expect(mocks.waitStack).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("未检测到运行中的 lanproxy"),
    );
    errorSpy.mockRestore();
  });
});
