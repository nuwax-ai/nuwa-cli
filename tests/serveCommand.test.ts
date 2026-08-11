import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const mocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
  startServeHttp: vi.fn(),
  stopHttp: vi.fn(),
  addAcceptedSecret: vi.fn(),
  bringUpFileServer: vi.fn(() => Promise.resolve(true)),
  stopFileServer: vi.fn(),
  bringUpLanproxy: vi.fn(() =>
    Promise.resolve({
      healthy: true,
      handle: {
        pid: 1234,
        ready: Promise.resolve(),
        stop: vi.fn(),
      },
    }),
  ),
  getDeviceId: vi.fn(() => "device-id"),
}));

vi.mock("../src/core/auth/regClient.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/auth/regClient.js")>();
  return {
    ...actual,
    registerClient: (...args: unknown[]) => mocks.registerClient(...args),
  };
});

vi.mock("../src/core/auth/deviceId.js", () => ({
  getDeviceId: () => mocks.getDeviceId(),
}));

vi.mock("../src/core/serve/server.js", () => ({
  startServeHttp: (...args: unknown[]) => mocks.startServeHttp(...args),
}));

vi.mock("../src/core/serve/fileServer.js", () => ({
  bringUpFileServer: (...args: unknown[]) => mocks.bringUpFileServer(...args),
  stopFileServer: (...args: unknown[]) => mocks.stopFileServer(...args),
}));

vi.mock("../src/core/serve/lanproxyProcess.js", () => ({
  bringUpLanproxy: (...args: unknown[]) => mocks.bringUpLanproxy(...args),
}));

// serve 启动时会 setImmediate 触发 MCP npx 缓存预热；mock 掉避免测试真实 spawn npx
vi.mock("../src/core/mcp/cacheWarmup.js", () => ({
  warmupMcpNpxCache: vi.fn().mockResolvedValue({ skipped: true }),
}));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
}

describe("serveCommand", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-serve-cmd-"));
    vi.resetModules();
    process.exitCode = 0;
    mocks.registerClient.mockReset();
    mocks.startServeHttp.mockReset();
    mocks.stopHttp.mockReset().mockResolvedValue(undefined);
    mocks.addAcceptedSecret.mockReset();
    mocks.bringUpFileServer.mockReset().mockResolvedValue(true);
    mocks.stopFileServer.mockReset();
    const stopLanproxy = vi.fn();
    mocks.bringUpLanproxy.mockReset().mockResolvedValue({
      healthy: true,
      handle: {
        pid: 1234,
        ready: Promise.resolve(),
        stop: stopLanproxy,
      },
    });
    mocks.startServeHttp.mockReturnValue({
      secret: "serve-secret",
      stop: mocks.stopHttp,
      addAcceptedSecret: mocks.addAcceptedSecret,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("keeps the current account mapping in sync after tunnel re-registration", async () => {
    const { writeCredentials, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "old-config",
      savedKey: "old-config",
      savedKeys: { "example.com_alice": "old-config" },
      accounts: {
        "example.com_alice": {
          domain: "https://example.com",
          username: "alice",
          computerName: "Alice Mac",
          savedKey: "old-config",
        },
      },
      serverHost: "existing-lanproxy.example.com",
      serverPort: 443,
    });
    mocks.registerClient.mockResolvedValue({
      id: 1,
      configKey: "renewed-config",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
    });

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.bringUpLanproxy.mock.calls.length > 0);
    process.emit("SIGINT");
    await running;

    expect(readCredentials()).toMatchObject({
      savedKey: "renewed-config",
      serverHost: "existing-lanproxy.example.com",
      serverPort: 443,
      savedKeys: { "example.com_alice": "renewed-config" },
      accounts: {
        "example.com_alice": {
          savedKey: "renewed-config",
          serverHost: "existing-lanproxy.example.com",
          serverPort: 443,
        },
      },
    });
    expect(mocks.bringUpLanproxy).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.objectContaining({
          serverHost: "existing-lanproxy.example.com",
          serverPort: 443,
          clientKey: "renewed-config",
        }),
        configKey: "renewed-config",
      }),
    );
    expect(mocks.addAcceptedSecret).toHaveBeenCalledWith("renewed-config");
    expect(mocks.startServeHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: path.join(tmpHome, ".nuwa-cli", "workspaces"),
        acceptedSecrets: ["old-config"],
        allowUnauthenticatedComputerRoutes: true,
      }),
    );
    expect(mocks.bringUpFileServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 60015,
        baseWorkspaceDir: path.join(tmpHome, ".nuwa-cli", "workspaces"),
      }),
    );
    // shutdown 调 handle.stop
    const handle = await mocks.bringUpLanproxy.mock.results[0]?.value;
    expect(handle.handle.stop).toHaveBeenCalled();
  });

  it("stops detached file-server when SIGINT arrives during health wait", async () => {
    const { writeCredentials } = await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "cfg",
      savedKey: "cfg",
      serverHost: "lanproxy.example.com",
      serverPort: 443,
    });
    mocks.registerClient.mockResolvedValue({
      id: 1,
      configKey: "cfg",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
    });

    // 卡住 bringUp；收到 abort 时结束，并模拟 onStarted 已标记可 stop
    mocks.bringUpFileServer.mockImplementation(
      async (opts: {
        signal?: AbortSignal;
        onStarted?: () => void;
      }) => {
        opts.onStarted?.();
        return new Promise<boolean>((resolve) => {
          if (opts.signal?.aborted) {
            resolve(false);
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(false), {
            once: true,
          });
        });
      },
    );

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.bringUpFileServer.mock.calls.length > 0);

    process.emit("SIGINT");
    await running;

    expect(mocks.stopHttp).toHaveBeenCalled();
    expect(mocks.stopFileServer).toHaveBeenCalledWith(
      60015,
      path.join(tmpHome, ".nuwa-cli", "workspaces"),
    );
    expect(mocks.bringUpLanproxy).not.toHaveBeenCalled();
    expect(
      mocks.bringUpFileServer.mock.calls[0]?.[0]?.signal,
    ).toBeInstanceOf(AbortSignal);
  });

  it("does not start file-server when SIGINT arrives during registerClient", async () => {
    const { writeCredentials } = await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "cfg",
      savedKey: "cfg",
      serverHost: "lanproxy.example.com",
      serverPort: 443,
    });

    let releaseRegister!: (value: unknown) => void;
    mocks.registerClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRegister = resolve;
        }),
    );

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.registerClient.mock.calls.length > 0);
    process.emit("SIGINT");
    await waitFor(() => mocks.stopHttp.mock.calls.length > 0);

    // 注册晚到：shutdown 已完成，不得再 spawn detached file-server。
    releaseRegister({
      id: 1,
      configKey: "cfg",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
      serverHost: "lanproxy.example.com",
      serverPort: 443,
    });
    await running;

    expect(mocks.bringUpFileServer).not.toHaveBeenCalled();
    expect(mocks.bringUpLanproxy).not.toHaveBeenCalled();
    expect(mocks.stopFileServer).not.toHaveBeenCalled();
  });

  it("skips lanproxy when file-server bring-up ultimately fails", async () => {
    const { writeCredentials } = await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "cfg",
      savedKey: "cfg",
      serverHost: "lanproxy.example.com",
      serverPort: 443,
    });
    mocks.registerClient.mockResolvedValue({
      id: 1,
      configKey: "cfg",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
    });
    mocks.bringUpFileServer.mockResolvedValue(false);

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.bringUpFileServer.mock.calls.length > 0);
    // 给事件循环一点时间：若错误地继续 bringUpLanproxy 会被观察到
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.bringUpLanproxy).not.toHaveBeenCalled();

    process.emit("SIGINT");
    await running;
  });

  it("stops lanproxy handle when SIGINT races after bringUp success", async () => {
    const { writeCredentials } = await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "cfg",
      savedKey: "cfg",
      serverHost: "lanproxy.example.com",
      serverPort: 443,
    });
    mocks.registerClient.mockResolvedValue({
      id: 1,
      configKey: "cfg",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
    });

    const stopLanproxy = vi.fn();
    // bringUp 成功返回前卡住；SIGINT 先跑完 shutdown（此时尚无 handle），
    // 再 resolve，验证 serve 在 shuttingDown 分支仍会 stop 返回的 handle。
    let releaseBringUp!: (value: {
      healthy: boolean;
      handle: { pid: number; stop: () => void };
    }) => void;
    mocks.bringUpLanproxy.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBringUp = resolve;
        }),
    );

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.bringUpLanproxy.mock.calls.length > 0);
    process.emit("SIGINT");
    await waitFor(() => mocks.stopHttp.mock.calls.length > 0);

    releaseBringUp({
      healthy: true,
      handle: { pid: 9999, stop: stopLanproxy },
    });
    await running;

    expect(stopLanproxy).toHaveBeenCalled();
  });
});
