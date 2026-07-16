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
