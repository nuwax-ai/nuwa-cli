import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let tempDir: string;
let previousProcessDir: string | undefined;

describe("processRegistry", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-processes-"));
    previousProcessDir = process.env.NUWACLI_PROCESS_DIR;
    process.env.NUWACLI_PROCESS_DIR = tempDir;
  });

  afterEach(() => {
    if (previousProcessDir === undefined) delete process.env.NUWACLI_PROCESS_DIR;
    else process.env.NUWACLI_PROCESS_DIR = previousProcessDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers, updates and unregisters the current process", async () => {
    const {
      listRegisteredProcesses,
      registerProcess,
      unregisterProcess,
      updateProcessRecord,
    } = await import("../src/core/processes/processRegistry.js");

    registerProcess({
      pid: process.pid,
      kind: "serve",
      state: "starting",
      daemon: true,
      cwd: "/tmp/project",
      port: 60016,
    });
    expect(listRegisteredProcesses()).toEqual([
      expect.objectContaining({
        pid: process.pid,
        kind: "serve",
        state: "starting",
        daemon: true,
      }),
    ]);

    updateProcessRecord(process.pid, { state: "running", port: 60017 });
    expect(listRegisteredProcesses()[0]).toMatchObject({
      state: "running",
      port: 60017,
    });

    unregisterProcess(process.pid);
    expect(listRegisteredProcesses()).toEqual([]);
  });

  it("removes stale records whose PID no longer exists", async () => {
    const { listRegisteredProcesses, registerProcess } =
      await import("../src/core/processes/processRegistry.js");
    registerProcess({
      pid: 99_999_999,
      kind: "ui",
      state: "running",
      daemon: false,
      cwd: "/tmp",
    });

    expect(listRegisteredProcesses()).toEqual([]);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });
});
