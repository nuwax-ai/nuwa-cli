import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import { spawn } from "node:child_process";
import { withEngineConnection } from "../src/core/acp/connection.js";
import { terminateProcessTree } from "../src/core/processes/killTree.js";
import { isPidAlive } from "../src/core/processes/processRegistry.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "mock-acp-agent.mjs");

function grandchildPidFile(): string {
  return path.join(
    os.tmpdir(),
    `nuwa-grandchild-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`,
  );
}

/** Polls the pid handshake file until the grandchild reports its pid. */
async function readGrandchildPid(
  pidFile: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 0;
}

describe("engine process-tree teardown", () => {
  it(
    "withEngineConnection tears down the whole tree (grandchild included) on abort",
    async () => {
      const pidFile = grandchildPidFile();
      const controller = new AbortController();
      const result = withEngineConnection(
        {
          command: process.execPath,
          args: [fixturePath],
          env: { ...process.env, NUWA_TEST_GRANDCHILD_PID_FILE: pidFile },
          cwd: process.cwd(),
        },
        { permissionMode: "yolo", onAgentText: () => {} },
        async (ctx) => {
          const session = await ctx.buildSession(process.cwd()).start();
          // Hang after spawning the grandchild — mirrors a long tool call.
          await session.prompt("spawn-grandchild");
          return "unreachable";
        },
        controller.signal,
      );

      // Wait for the pid handshake *before* aborting. A fixed sleep races under
      // full-suite load (initialize + session/new + prompt can exceed 200ms),
      // which made readGrandchildPid return 0 after teardown already wiped the
      // tree (or never let the grandchild start).
      const grandchildPid = await readGrandchildPid(pidFile, 10000);
      expect(grandchildPid).toBeGreaterThan(0);

      controller.abort();
      await expect(result).rejects.toThrow(/engine session aborted/);

      // Default killTree budget is 6s; assert the grandchild is gone within
      // the teardown window plus margin.
      await expect
        .poll(() => isPidAlive(grandchildPid), { timeout: 8000, interval: 100 })
        .toBe(false);
      fs.rmSync(pidFile, { force: true });
    },
    20000,
  );

  it(
    "terminateProcessTree escalates to group SIGKILL for a SIGTERM-ignoring grandchild",
    async () => {
      const pidFile = grandchildPidFile();
      const proc = spawn(process.execPath, [fixturePath], {
        env: {
          ...process.env,
          NUWA_TEST_GRANDCHILD_ON_START: "1",
          NUWA_TEST_GRANDCHILD_PID_FILE: pidFile,
        },
        stdio: "pipe",
        detached: process.platform !== "win32",
      });
      const grandchildPid = await readGrandchildPid(pidFile, 5000);
      expect(grandchildPid).toBeGreaterThan(0);

      const started = Date.now();
      await terminateProcessTree(proc, {
        naturalExitMs: 500,
        termEscalateMs: 1000,
        killVerifyMs: 500,
      });
      const elapsed = Date.now() - started;
      // Injected budget (2s) + margin: the grandchild ignores SIGTERM, so the
      // group SIGKILL escalation must have run inside this window.
      expect(elapsed).toBeLessThan(500 + 1000 + 500 + 500);
      await expect
        .poll(() => isPidAlive(grandchildPid), { timeout: 2000, interval: 100 })
        .toBe(false);
      fs.rmSync(pidFile, { force: true });
    },
    20000,
  );

  it(
    "resolves inside naturalExitMs when the adapter exits cleanly with its tree (no group SIGTERM)",
    async () => {
      const pidFile = grandchildPidFile();
      const proc = spawn(process.execPath, [fixturePath], {
        env: {
          ...process.env,
          NUWA_TEST_GRANDCHILD_ON_START: "1",
          NUWA_TEST_GRACEFUL_EXIT_MS: "200",
          NUWA_TEST_GRACEFUL_KILL_GRANDCHILD: "1",
          NUWA_TEST_GRANDCHILD_PID_FILE: pidFile,
        },
        stdio: "pipe",
        detached: process.platform !== "win32",
      });
      const grandchildPid = await readGrandchildPid(pidFile, 5000);
      expect(grandchildPid).toBeGreaterThan(0);

      const naturalExitMs = 1000;
      const started = Date.now();
      await terminateProcessTree(proc, {
        naturalExitMs,
        termEscalateMs: 5000,
        killVerifyMs: 500,
      });
      const elapsed = Date.now() - started;
      // The adapter cleans up its own grandchild and exits 200ms after stdin
      // EOF, so teardown must resolve inside the natural window — proving no
      // group SIGTERM/SIGKILL was sent.
      expect(elapsed).toBeLessThan(naturalExitMs);
      await expect
        .poll(() => isPidAlive(grandchildPid), { timeout: 2000, interval: 100 })
        .toBe(false);
      fs.rmSync(pidFile, { force: true });
    },
    20000,
  );
});

describe.skipIf(process.platform !== "win32")("Windows taskkill tree teardown", () => {
  it(
    "terminateProcessTree uses taskkill /T /F and clears the grandchild",
    async () => {
      const pidFile = grandchildPidFile();
      const proc = spawn(process.execPath, [fixturePath], {
        env: {
          ...process.env,
          NUWA_TEST_GRANDCHILD_ON_START: "1",
          NUWA_TEST_HANG_ON_EOF: "1",
          NUWA_TEST_GRANDCHILD_PID_FILE: pidFile,
        },
        stdio: "pipe",
      });
      const grandchildPid = await readGrandchildPid(pidFile, 5000);
      expect(grandchildPid).toBeGreaterThan(0);

      await terminateProcessTree(proc, {
        naturalExitMs: 500,
        killVerifyMs: 500,
      });
      await expect
        .poll(() => isPidAlive(grandchildPid), { timeout: 5000, interval: 100 })
        .toBe(false);
      fs.rmSync(pidFile, { force: true });
    },
    20000,
  );
});
