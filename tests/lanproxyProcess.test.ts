import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  kill: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("../src/core/processes/processRegistry.js", () => ({
  registerProcess: (...args: unknown[]) => mocks.register(...args),
  unregisterProcess: (...args: unknown[]) => mocks.unregister(...args),
  isPidAlive: (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
}));

describe("startLanproxy", () => {
  let tmpDir: string;
  let savedSavedKey: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    mocks.spawn.mockReset();
    mocks.kill.mockReset();
    mocks.register.mockReset();
    mocks.unregister.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-lanproxy-proc-"));
    savedSavedKey = process.env.NUWAX_SAVED_KEY;
    process.env.NUWAX_SAVED_KEY = "electron-key";
  });

  afterEach(() => {
    if (savedSavedKey === undefined) delete process.env.NUWAX_SAVED_KEY;
    else process.env.NUWAX_SAVED_KEY = savedSavedKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spawns lanproxy with Electron-compatible client args", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-test");
    fs.writeFileSync(bin, "");
    const { startLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");

    const proc = Object.assign(new EventEmitter(), {
      pid: 1234,
      killed: false,
      kill: mocks.kill,
    });
    mocks.spawn.mockReturnValue(proc);
    const handle = startLanproxy({
      pathOverride: bin,
      serverHost: "https://agent.nuwax.com/",
      serverPort: 443,
      clientKey: "saved-key",
      ssl: true,
    });
    proc.emit("spawn");
    await handle.ready;

    expect(mocks.spawn).toHaveBeenCalledWith(
      bin,
      ["-s", "agent.nuwax.com", "-p", "443", "-k", "saved-key", "--ssl=true"],
      {
        env: expect.not.objectContaining({ NUWAX_SAVED_KEY: "electron-key" }),
        stdio: "ignore",
        windowsHide: true,
      },
    );
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: 1234,
        kind: "lanproxy",
        state: "running",
        host: "agent.nuwax.com",
        port: 443,
      }),
    );
    handle.stop();
    expect(mocks.kill).toHaveBeenCalled();
  });

  it("rejects readiness when lanproxy exits immediately", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-test");
    fs.writeFileSync(bin, "");
    const proc = Object.assign(new EventEmitter(), {
      pid: 4321,
      killed: false,
      kill: mocks.kill,
    });
    mocks.spawn.mockReturnValue(proc);
    const { startLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");
    const handle = startLanproxy({
      pathOverride: bin,
      serverHost: "agent.nuwax.com",
      serverPort: 443,
      clientKey: "saved-key",
    });

    proc.emit("spawn");
    proc.emit("exit", 1, null);

    await expect(handle.ready).rejects.toThrow("启动后立即退出");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.unregister).toHaveBeenCalledWith(4321);
  });
});

describe("confirmLanproxyHealthy", () => {
  it("returns false when pid is undefined", async () => {
    const { confirmLanproxyHealthy } =
      await import("../src/core/serve/lanproxyProcess.js");
    expect(await confirmLanproxyHealthy(undefined, 0)).toBe(false);
  });

  it("returns true when the pid stays alive across the stabilize window", async () => {
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
    const { confirmLanproxyHealthy } =
      await import("../src/core/serve/lanproxyProcess.js");

    expect(await confirmLanproxyHealthy(9999, 0)).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false when the pid dies during the stabilize window", async () => {
    // 用调用次数区分「稳定窗口前存活 / 窗口后死亡」，避免 setTimeout 竞态。
    let calls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      calls += 1;
      if (calls === 1) return true;
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    const { confirmLanproxyHealthy } =
      await import("../src/core/serve/lanproxyProcess.js");

    expect(await confirmLanproxyHealthy(9999, 5)).toBe(false);
    expect(calls).toBe(2);
    killSpy.mockRestore();
  });
});

describe("waitForLanproxyTunnel", () => {
  it("resolves true when the cloud reports the tunnel online (code 0000)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "0000", success: true, data: {} }),
    } as Response);
    const { waitForLanproxyTunnel } =
      await import("../src/core/serve/lanproxyProcess.js");

    const ok = await waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      1000,
      10,
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/sandbox/config/health/config-key",
      expect.any(Object),
    );
    fetchMock.mockRestore();
  });

  it("retries until the tunnel comes online", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "9999", success: false }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ code: "0000", success: true, data: { online: true } }),
      } as Response);
    const { waitForLanproxyTunnel } =
      await import("../src/core/serve/lanproxyProcess.js");

    const ok = await waitForLanproxyTunnel(
      "https://example.com/",
      "config-key",
      5000,
      10,
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/sandbox/config/health/config-key",
      expect.any(Object),
    );
    fetchMock.mockRestore();
  });

  it("resolves false when the tunnel never comes online within the timeout", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ code: "9999", success: false }),
      } as Response);
    const { waitForLanproxyTunnel } =
      await import("../src/core/serve/lanproxyProcess.js");

    const ok = await waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      100,
      10,
    );

    expect(ok).toBe(false);
    fetchMock.mockRestore();
  });

  it("resolves false without a request when domain or configKey is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { waitForLanproxyTunnel } =
      await import("../src/core/serve/lanproxyProcess.js");

    expect(await waitForLanproxyTunnel("", "config-key", 100, 10)).toBe(false);
    expect(await waitForLanproxyTunnel("https://example.com", "", 100, 10)).toBe(
      false,
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
    const { waitForLanproxyTunnel } =
      await import("../src/core/serve/lanproxyProcess.js");
    const ac = new AbortController();

    const pending = waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      15_000,
      500,
      ac.signal,
    );
    ac.abort();
    expect(await pending).toBe(false);
    fetchMock.mockRestore();
  });
});

describe("bringUpLanproxy", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    mocks.spawn.mockReset();
    mocks.kill.mockReset();
    mocks.register.mockReset();
    mocks.unregister.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-lanproxy-bringup-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("retries when tunnel health fails then succeeds", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-test");
    fs.writeFileSync(bin, "");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      // 第一次完整启动全程隧道不健康；第二次 spawn 后才 online
      if (mocks.spawn.mock.calls.length < 2) {
        return {
          ok: true,
          json: async () => ({ code: "9999", success: false }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          code: "0000",
          success: true,
          data: { online: true },
        }),
      } as Response;
    });

    // confirmLanproxyHealthy 用真实 isPidAlive(本进程 pid) 会通过；给假 pid 用当前进程
    const makeProc = () =>
      Object.assign(new EventEmitter(), {
        pid: process.pid,
        killed: false,
        kill: mocks.kill,
      });

    mocks.spawn.mockImplementation(() => {
      const proc = makeProc();
      queueMicrotask(() => proc.emit("spawn"));
      return proc;
    });

    const { bringUpLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");

    const result = await bringUpLanproxy({
      start: {
        pathOverride: bin,
        serverHost: "agent.example.com",
        serverPort: 443,
        clientKey: "key",
      },
      domain: "https://example.com",
      configKey: "key",
      stabilizeMs: 0,
      tunnelTimeoutMs: 40,
      tunnelIntervalMs: 10,
      maxAttempts: 3,
      backoffMs: [0, 0],
    });

    expect(result.healthy).toBe(true);
    expect(result.handle?.pid).toBe(process.pid);
    expect(mocks.spawn.mock.calls.length).toBeGreaterThanOrEqual(2);
    fetchMock.mockRestore();
  });

  it("on abort during tunnel wait: stops process and does not retry spawn", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-abort");
    fs.writeFileSync(bin, "");

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

    mocks.spawn.mockImplementation(() => {
      const proc = Object.assign(new EventEmitter(), {
        pid: process.pid,
        killed: false,
        kill: mocks.kill,
      });
      queueMicrotask(() => proc.emit("spawn"));
      return proc;
    });

    const { bringUpLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");
    const ac = new AbortController();

    const pending = bringUpLanproxy({
      start: {
        pathOverride: bin,
        serverHost: "agent.example.com",
        serverPort: 443,
        clientKey: "key",
      },
      domain: "https://example.com",
      configKey: "key",
      stabilizeMs: 0,
      tunnelTimeoutMs: 30_000,
      tunnelIntervalMs: 200,
      maxAttempts: 3,
      backoffMs: [0, 0],
      signal: ac.signal,
    });

    await waitFor(() => mocks.spawn.mock.calls.length >= 1);
    // 等到隧道轮询已挂上 fetch，再 abort
    await waitFor(() => fetchMock.mock.calls.length >= 1);
    ac.abort();
    const result = await pending;

    expect(result.healthy).toBe(false);
    expect(result.handle).toBeNull();
    expect(mocks.kill).toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("treats abort during stabilize as aborted, not stabilize failure", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-stabilize-abort");
    fs.writeFileSync(bin, "");

    mocks.spawn.mockImplementation(() => {
      const proc = Object.assign(new EventEmitter(), {
        pid: process.pid,
        killed: false,
        kill: mocks.kill,
      });
      queueMicrotask(() => proc.emit("spawn"));
      return proc;
    });

    const { bringUpLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");
    const ac = new AbortController();

    const pending = bringUpLanproxy({
      start: {
        pathOverride: bin,
        serverHost: "agent.example.com",
        serverPort: 443,
        clientKey: "key",
      },
      domain: "https://example.com",
      configKey: "key",
      // 稳定窗口内 abort，confirmProcessHealthy 会返回 false
      stabilizeMs: 5_000,
      tunnelTimeoutMs: 100,
      maxAttempts: 3,
      backoffMs: [0, 0],
      signal: ac.signal,
    });

    await waitFor(() => mocks.spawn.mock.calls.length >= 1);
    // ready 后进入 stabilize 等待
    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();
    const result = await pending;

    expect(result.healthy).toBe(false);
    expect(mocks.kill).toHaveBeenCalled();
    // 不得因「stabilize 失败」再完整重试 spawn
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}