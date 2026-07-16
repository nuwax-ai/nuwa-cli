import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

let tempDir: string;
const savedEnv: Record<string, string | undefined> = {};

describe("uiSingleton", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-ui-singleton-"));
    for (const key of [
      "NUWACLI_PROCESS_DIR",
      "NUWACLI_UI_GUARD_PATH",
      "NUWACLI_DISABLE_PROCESS_SCAN",
    ]) savedEnv[key] = process.env[key];
    process.env.NUWACLI_PROCESS_DIR = path.join(tempDir, "processes");
    process.env.NUWACLI_UI_GUARD_PATH = path.join(tempDir, "ui.guard");
    process.env.NUWACLI_DISABLE_PROCESS_SCAN = "1";
  });

  afterEach(async () => {
    const { releaseUiSingleton } =
      await import("../src/core/processes/uiSingleton.js");
    releaseUiSingleton();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows only one foreground Console and --force replaces it", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    await once(child, "spawn");
    const { registerProcess } =
      await import("../src/core/processes/processRegistry.js");
    const { acquireUiSingleton } =
      await import("../src/core/processes/uiSingleton.js");
    registerProcess({
      pid: child.pid!,
      kind: "ui",
      state: "running",
      daemon: false,
      cwd: "/tmp",
    });

    await expect(acquireUiSingleton(false)).rejects.toThrow("--force");
    const exited = once(child, "exit");
    await expect(acquireUiSingleton(true)).resolves.toEqual([child.pid]);
    await exited;
  });

  it("doctor repair keeps the newest registered Console", async () => {
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
    const { repairUiSingleton } =
      await import("../src/core/processes/uiSingleton.js");
    registerProcess({
      pid: first.pid!,
      kind: "ui",
      state: "running",
      daemon: false,
      cwd: "/tmp",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    registerProcess({
      pid: second.pid!,
      kind: "ui",
      state: "running",
      daemon: false,
      cwd: "/tmp",
      startedAt: "2026-01-02T00:00:00.000Z",
    });

    const firstExited = once(first, "exit");
    await expect(repairUiSingleton()).resolves.toEqual({
      keptPid: second.pid,
      stoppedPids: [first.pid],
    });
    await firstExited;
    expect(isPidAlive(second.pid!)).toBe(true);

    const secondExited = once(second, "exit");
    second.kill("SIGTERM");
    await secondExited;
  });
});
