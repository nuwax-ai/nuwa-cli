import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

let tempDir: string;
const savedEnv: Record<string, string | undefined> = {};

describe("serveSingleton", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-singleton-"));
    for (const key of [
      "NUWACLI_PROCESS_DIR",
      "NUWACLI_SERVE_GUARD_PATH",
      "NUWACLI_SERVE_LOCK_PATH",
      "NUWACLI_DISABLE_PROCESS_SCAN",
    ]) savedEnv[key] = process.env[key];
    process.env.NUWACLI_PROCESS_DIR = path.join(tempDir, "processes");
    process.env.NUWACLI_SERVE_GUARD_PATH = path.join(tempDir, "serve.guard");
    process.env.NUWACLI_SERVE_LOCK_PATH = path.join(tempDir, "serve.lock");
    process.env.NUWACLI_DISABLE_PROCESS_SCAN = "1";
  });

  afterEach(async () => {
    const { releaseServeSingleton } =
      await import("../src/core/processes/serveSingleton.js");
    releaseServeSingleton();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("claims one atomic guard and lets its owner re-enter", async () => {
    const { acquireServeSingleton } =
      await import("../src/core/processes/serveSingleton.js");
    expect(await acquireServeSingleton(false)).toEqual([]);
    expect(await acquireServeSingleton(false)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(process.env.NUWACLI_SERVE_GUARD_PATH!, "utf8"))).toMatchObject({
      pid: process.pid,
    });
  });

  it("blocks a second serve and --force replaces the old process", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    await once(child, "spawn");
    const { registerProcess } =
      await import("../src/core/processes/processRegistry.js");
    const { acquireServeSingleton } =
      await import("../src/core/processes/serveSingleton.js");
    registerProcess({
      pid: child.pid!,
      kind: "serve",
      state: "running",
      daemon: true,
      cwd: "/tmp",
    });

    await expect(acquireServeSingleton(false)).rejects.toThrow("--force");
    const exited = once(child, "exit");
    await expect(acquireServeSingleton(true)).resolves.toEqual([child.pid]);
    await exited;
  });

  it("force-stop also clears registered lanproxy and file-server children", async () => {
    const serve = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const lanproxy = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const fileServer = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    await Promise.all([
      once(serve, "spawn"),
      once(lanproxy, "spawn"),
      once(fileServer, "spawn"),
    ]);

    const { registerProcess, isPidAlive, listRegisteredProcesses } =
      await import("../src/core/processes/processRegistry.js");
    const { stopServeProcesses } =
      await import("../src/core/processes/serveSingleton.js");

    registerProcess({
      pid: serve.pid!,
      kind: "serve",
      state: "running",
      daemon: true,
      cwd: tempDir,
    });
    registerProcess({
      pid: lanproxy.pid!,
      kind: "lanproxy",
      state: "running",
      daemon: true,
      cwd: tempDir,
      host: "testagent.example.com",
      port: 10076,
    });
    registerProcess({
      pid: fileServer.pid!,
      kind: "file-server",
      state: "running",
      daemon: true,
      cwd: tempDir,
      port: 60015,
    });

    const exits = Promise.all([
      once(serve, "exit"),
      once(lanproxy, "exit"),
      once(fileServer, "exit"),
    ]);
    await stopServeProcesses([serve.pid!], { stopSystemService: false });
    await exits;

    expect(isPidAlive(serve.pid!)).toBe(false);
    expect(isPidAlive(lanproxy.pid!)).toBe(false);
    expect(isPidAlive(fileServer.pid!)).toBe(false);
    expect(
      listRegisteredProcesses().filter(
        (r) =>
          r.kind === "lanproxy" ||
          r.kind === "file-server" ||
          r.kind === "serve",
      ),
    ).toEqual([]);
  });

  it("doctor repair keeps the lock owner and stops duplicate serves", async () => {
    const first = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const second = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    await Promise.all([once(first, "spawn"), once(second, "spawn")]);
    const { registerProcess, isPidAlive } =
      await import("../src/core/processes/processRegistry.js");
    const { writeServeLock } =
      await import("../src/core/serve/serveLock.js");
    const { repairServeSingleton } =
      await import("../src/core/processes/serveSingleton.js");
    for (const pid of [first.pid!, second.pid!]) {
      registerProcess({
        pid,
        kind: "serve",
        state: "running",
        daemon: true,
        cwd: "/tmp",
      });
    }
    writeServeLock({
      pid: first.pid!,
      port: 60016,
      host: "127.0.0.1",
      startedAt: new Date().toISOString(),
    });

    const secondExited = once(second, "exit");
    await expect(repairServeSingleton()).resolves.toEqual({
      keptPid: first.pid,
      stoppedPids: [second.pid],
    });
    await secondExited;
    expect(isPidAlive(first.pid!)).toBe(true);

    const firstExited = once(first, "exit");
    first.kill("SIGTERM");
    await firstExited;
  });

  it("recognises nuwa-cli serve commands without matching another dist/cli", async () => {
    const { isNuwaServeCommand, parseNuwaProcessKind } =
      await import("../src/core/processes/serveSingleton.js");
    expect(isNuwaServeCommand("node /work/nuwa-cli/dist/cli.js serve --daemon")).toBe(true);
    // Old processes must remain discoverable for cleanup even though the old
    // command name is no longer accepted by the CLI.
    expect(isNuwaServeCommand("nuwa-cli up --force")).toBe(true);
    expect(isNuwaServeCommand("nuwa-cli gateway --force")).toBe(true);
    expect(isNuwaServeCommand("node /work/nuwaclaw/dist/cli.js serve")).toBe(false);
    expect(isNuwaServeCommand("node /work/nuwa-cli/dist/cli.js status")).toBe(false);
    expect(parseNuwaProcessKind("node /work/nuwa-cli/dist/cli.js ui")).toBe("ui");
    expect(parseNuwaProcessKind("nuwa-cli console")).toBe("ui");
    expect(parseNuwaProcessKind("nuwa-cli start")).toBe("ui");
    expect(parseNuwaProcessKind("nuwa-cli chat --engine claude")).toBe("chat");
    expect(
      parseNuwaProcessKind(
        "/bin/zsh -c node /work/nuwa-cli/dist/cli.js serve",
      ),
    ).toBeNull();
  });

  it("transfers the serve guard to a daemon child pid", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await once(child, "spawn");
    try {
      const {
        acquireServeSingleton,
        transferServeSingleton,
      } = await import("../src/core/processes/serveSingleton.js");
      await acquireServeSingleton(false);
      transferServeSingleton(process.pid, child.pid!);
      const guard = JSON.parse(
        fs.readFileSync(process.env.NUWACLI_SERVE_GUARD_PATH!, "utf8"),
      );
      expect(guard.pid).toBe(child.pid);
    } finally {
      child.kill();
      await once(child, "exit");
    }
  });
});
