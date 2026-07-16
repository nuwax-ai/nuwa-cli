import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  ui: vi.fn(),
  findGateway: vi.fn(),
  findConsole: vi.fn(),
  records: vi.fn(),
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
    process.exitCode = 0;
  });

  it("starts Gateway as a daemon before the foreground Console", async () => {
    const { startCommand } = await import("../src/commands/start.js");
    await startCommand({ engine: "codex", open: false, approve: "ask" });

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

  it("reuses healthy Gateway and Console instances", async () => {
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
  });

  it("forces replacement of both services", async () => {
    mocks.findGateway.mockReturnValue([101]);
    mocks.findConsole.mockReturnValue([202]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({ force: true, open: false });

    expect(mocks.gateway).toHaveBeenCalledWith({
      daemon: true,
      force: true,
    });
    expect(mocks.ui).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, open: false }),
    );
  });

  it("does not start Console when Gateway fails", async () => {
    mocks.gateway.mockImplementation(async () => {
      process.exitCode = 1;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { startCommand } = await import("../src/commands/start.js");

    await startCommand({});

    expect(mocks.ui).not.toHaveBeenCalled();
  });
});
