import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInstalledPackageEntry: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  unref: vi.fn(),
  ensureDir: vi.fn(),
  tmpDir: vi.fn(() => "/tmp/nuwa-cli-test"),
  workspacesDir: vi.fn(() => "/tmp/nuwa-cli-workspaces"),
  logsDir: vi.fn(() => "/tmp/nuwa-cli-logs"),
  registerProcess: vi.fn(),
  unregisterProcess: vi.fn(),
}));

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: mocks.resolveInstalledPackageEntry,
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));

vi.mock("../src/util/paths.js", () => ({
  ensureDir: mocks.ensureDir,
  logsDir: mocks.logsDir,
  tmpDir: mocks.tmpDir,
  workspacesDir: mocks.workspacesDir,
}));

vi.mock("../src/core/processes/processRegistry.js", () => ({
  registerProcess: (...args: unknown[]) => mocks.registerProcess(...args),
  unregisterProcess: (...args: unknown[]) => mocks.unregisterProcess(...args),
}));

describe("fileServer", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveInstalledPackageEntry.mockReset();
    mocks.spawn.mockReset();
    mocks.spawnSync.mockReset();
    mocks.unref.mockReset();
    mocks.ensureDir.mockReset();
    mocks.tmpDir.mockClear();
    mocks.workspacesDir.mockClear();
    mocks.logsDir.mockClear();
    mocks.registerProcess.mockReset();
    mocks.unregisterProcess.mockReset();
    mocks.resolveInstalledPackageEntry.mockReturnValue(
      "/fake/nuwax-file-server.js",
    );
    mocks.spawn.mockReturnValue({ pid: 4242, unref: mocks.unref });
  });

  it("registers pid on start and unregisters on stop", async () => {
    const { startFileServer, stopFileServer } =
      await import("../src/core/serve/fileServer.js");

    startFileServer(60015);
    expect(mocks.registerProcess).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 4242, kind: "file-server", port: 60015 }),
    );

    stopFileServer(60015);
    expect(mocks.spawnSync).toHaveBeenCalled();
    expect(mocks.unregisterProcess).toHaveBeenCalledWith(4242);
  });

  it("unregisters previous pid when restarting the same port", async () => {
    mocks.spawn
      .mockReturnValueOnce({ pid: 1001, unref: mocks.unref })
      .mockReturnValueOnce({ pid: 1002, unref: mocks.unref });
    const { startFileServer } = await import("../src/core/serve/fileServer.js");

    startFileServer(60015);
    startFileServer(60015);

    expect(mocks.unregisterProcess).toHaveBeenCalledWith(1001);
    expect(mocks.registerProcess).toHaveBeenLastCalledWith(
      expect.objectContaining({ pid: 1002, port: 60015 }),
    );
  });

  it("starts the package dependency entry with the requested port", async () => {
    const { startFileServer } = await import("../src/core/serve/fileServer.js");

    startFileServer(60015);

    expect(mocks.resolveInstalledPackageEntry).toHaveBeenCalledWith(
      "nuwax-file-server",
      "nuwax-file-server/dist/cli.js",
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/fake/nuwax-file-server.js", "start", "--port", "60015"],
      {
        env: expect.objectContaining({
          TMPDIR: "/tmp/nuwa-cli-test/file-server-60015",
          TMP: "/tmp/nuwa-cli-test/file-server-60015",
          TEMP: "/tmp/nuwa-cli-test/file-server-60015",
          COMPUTER_WORKSPACE_DIR: "/tmp/nuwa-cli-workspaces",
          PROJECT_SOURCE_DIR: "/tmp/nuwa-cli-workspaces/project_workspace",
          UPLOAD_PROJECT_DIR: "/tmp/nuwa-cli-test/file-server-project-zips",
          DIST_TARGET_DIR: "/tmp/nuwa-cli-test/file-server-dist",
          LOG_BASE_DIR: "/tmp/nuwa-cli-logs/file-server/project_logs",
          COMPUTER_LOG_DIR: "/tmp/nuwa-cli-logs/file-server/computer_logs",
        }),
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      },
    );
    expect(mocks.ensureDir).toHaveBeenCalledWith(
      "/tmp/nuwa-cli-test/file-server-60015",
    );
    expect(mocks.ensureDir).toHaveBeenCalledWith("/tmp/nuwa-cli-workspaces");
    expect(mocks.unref).toHaveBeenCalled();
  });

  it("stops the package dependency entry when available", async () => {
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    stopFileServer(60015);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ["/fake/nuwax-file-server.js", "stop"],
      {
        env: expect.objectContaining({
          TMPDIR: "/tmp/nuwa-cli-test/file-server-60015",
          TMP: "/tmp/nuwa-cli-test/file-server-60015",
          TEMP: "/tmp/nuwa-cli-test/file-server-60015",
          COMPUTER_WORKSPACE_DIR: "/tmp/nuwa-cli-workspaces",
        }),
        stdio: "ignore",
        windowsHide: true,
      },
    );
  });

  it("does not throw during shutdown when the package entry is missing", async () => {
    mocks.resolveInstalledPackageEntry.mockImplementationOnce(() => {
      throw new Error("missing");
    });
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    expect(() => stopFileServer(60015)).not.toThrow();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});

describe("waitForFileServerHealth", () => {
  it("resolves true when /health returns status ok", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    } as Response);
    const { waitForFileServerHealth } =
      await import("../src/core/serve/fileServer.js");

    const ok = await waitForFileServerHealth(60015, 1000, 10);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:60015/health",
      expect.any(Object),
    );
    fetchMock.mockRestore();
  });

  it("retries until the server becomes healthy", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok" }),
      } as Response);
    const { waitForFileServerHealth } =
      await import("../src/core/serve/fileServer.js");

    const ok = await waitForFileServerHealth(60015, 5000, 10);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockRestore();
  });

  it("resolves false when health never becomes ok within the timeout", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const { waitForFileServerHealth } =
      await import("../src/core/serve/fileServer.js");

    const ok = await waitForFileServerHealth(60015, 100, 10);

    expect(ok).toBe(false);
    fetchMock.mockRestore();
  });

  it("resolves false immediately when the abort signal fires", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const { waitForFileServerHealth } =
      await import("../src/core/serve/fileServer.js");
    const ac = new AbortController();

    const pending = waitForFileServerHealth(60015, 10_000, 200, ac.signal);
    ac.abort();
    const ok = await pending;

    expect(ok).toBe(false);
    fetchMock.mockRestore();
  });
});

describe("bringUpFileServer", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveInstalledPackageEntry.mockReset();
    mocks.spawn.mockReset();
    mocks.spawnSync.mockReset();
    mocks.unref.mockReset();
    mocks.resolveInstalledPackageEntry.mockReturnValue(
      "/fake/nuwax-file-server.js",
    );
    mocks.spawn.mockReturnValue({ unref: mocks.unref });
  });

  it("retries after health failure then succeeds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      // 同一轮健康轮询内始终失败，直到第二次 spawn（完整重试）
      if (mocks.spawn.mock.calls.length < 2) {
        throw new Error("ECONNREFUSED");
      }
      return {
        ok: true,
        json: async () => ({ status: "ok" }),
      } as Response;
    });

    const { bringUpFileServer } =
      await import("../src/core/serve/fileServer.js");
    const onStarted = vi.fn();

    const ok = await bringUpFileServer({
      port: 60015,
      timeoutMs: 40,
      intervalMs: 10,
      maxAttempts: 3,
      backoffMs: [0, 0],
      onStarted,
    });

    expect(ok).toBe(true);
    expect(onStarted.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.spawnSync).toHaveBeenCalled(); // stop after fail / before retry
    fetchMock.mockRestore();
  });

  it("returns false after retries are exhausted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const { bringUpFileServer } =
      await import("../src/core/serve/fileServer.js");

    const ok = await bringUpFileServer({
      port: 60015,
      timeoutMs: 30,
      intervalMs: 10,
      maxAttempts: 2,
      backoffMs: [0],
    });

    expect(ok).toBe(false);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });
});
