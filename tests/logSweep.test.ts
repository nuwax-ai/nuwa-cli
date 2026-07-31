import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-logSweep-"));
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write a file and backdate its mtime by `ageDays` days (real clock). */
function writeWithAge(file: string, ageDays: number): void {
  fs.writeFileSync(file, "x\n");
  const t = (Date.now() - ageDays * DAY_MS) / 1000;
  fs.utimesSync(file, t, t);
}

/** Write a file and set its mtime to an explicit epoch (for fake-clock tests). */
function touchAt(file: string, epochMs: number): void {
  fs.writeFileSync(file, "x\n");
  const t = epochMs / 1000;
  fs.utimesSync(file, t, t);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("sweepOldLogs", () => {
  it("retention default is 10 days", async () => {
    const { LOG_RETENTION_DAYS } = await import("../src/core/logSweep.js");
    expect(LOG_RETENTION_DAYS).toBe(10);
  });

  it("deletes .log files older than retention, keeps recent ones", async () => {
    const { sweepOldLogs } = await import("../src/core/logSweep.js");
    const old = path.join(root, "main.2026-07-01.log");
    const recent = path.join(root, "main.recent.log");
    writeWithAge(old, 15);
    writeWithAge(recent, 3);
    sweepOldLogs(10, root);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it("never deletes latest.log or the active app-server.log", async () => {
    const { sweepOldLogs } = await import("../src/core/logSweep.js");
    const latest = path.join(root, "latest.log");
    const codexDir = path.join(root, "codex");
    fs.mkdirSync(codexDir);
    const active = path.join(codexDir, "app-server.log");
    writeWithAge(latest, 30);
    writeWithAge(active, 30);
    sweepOldLogs(10, root);
    expect(fs.existsSync(latest)).toBe(true);
    expect(fs.existsSync(active)).toBe(true);
  });

  it("leaves non-.log files untouched (locks, json, guard)", async () => {
    const { sweepOldLogs } = await import("../src/core/logSweep.js");
    const files = ["serve.lock", "x.json", "ui.guard", "config.json"].map(
      (n) => path.join(root, n),
    );
    for (const f of files) writeWithAge(f, 30);
    sweepOldLogs(10, root);
    for (const f of files) expect(fs.existsSync(f)).toBe(true);
  });

  it("recurses into subdirs and prunes emptied directories", async () => {
    const { sweepOldLogs } = await import("../src/core/logSweep.js");
    const mcpDir = path.join(root, "mcp-proxy", "proj1");
    const fsDir = path.join(root, "file-server", "project_logs", "proj2");
    fs.mkdirSync(mcpDir, { recursive: true });
    fs.mkdirSync(fsDir, { recursive: true });
    const oldMcp = path.join(mcpDir, "server-2026-07-01.log");
    const oldFs = path.join(fsDir, "api-2026-07-01.log");
    writeWithAge(oldMcp, 15);
    writeWithAge(oldFs, 15);
    sweepOldLogs(10, root);
    expect(fs.existsSync(oldMcp)).toBe(false);
    expect(fs.existsSync(oldFs)).toBe(false);
    // now-empty dirs pruned bottom-up (but never rootDir itself)
    expect(fs.existsSync(mcpDir)).toBe(false);
    expect(fs.existsSync(path.join(root, "mcp-proxy"))).toBe(false);
    expect(fs.existsSync(path.join(root, "file-server"))).toBe(false);
    expect(fs.existsSync(root)).toBe(true);
  });
});

describe("rotateCodexLog", () => {
  it("cold-start: rolls a stale app-server.log to app-server-<its-day>.log", async () => {
    const { rotateCodexLog } = await import("../src/core/logSweep.js");
    const codexDir = path.join(root, "codex");
    fs.mkdirSync(codexDir);
    const active = path.join(codexDir, "app-server.log");
    const old = new Date(Date.now() - 5 * DAY_MS);
    touchAt(active, old.getTime());
    rotateCodexLog(codexDir);
    expect(fs.existsSync(active)).toBe(false);
    expect(
      fs.existsSync(path.join(codexDir, `app-server-${ymd(old)}.log`)),
    ).toBe(true);
  });

  it("cold-start: leaves today's app-server.log in place", async () => {
    const { rotateCodexLog } = await import("../src/core/logSweep.js");
    const codexDir = path.join(root, "codex");
    fs.mkdirSync(codexDir);
    const active = path.join(codexDir, "app-server.log");
    fs.writeFileSync(active, "x\n");
    rotateCodexLog(codexDir);
    expect(fs.existsSync(active)).toBe(true);
    expect(
      fs.readdirSync(codexDir).filter((n) => n.startsWith("app-server-")),
    ).toEqual([]);
  });

  it("steady-state: rolls over when the day advances", async () => {
    vi.useFakeTimers();
    const { rotateCodexLog } = await import("../src/core/logSweep.js");
    const codexDir = path.join(root, "codex");
    fs.mkdirSync(codexDir);
    const active = path.join(codexDir, "app-server.log");
    const day1 = new Date("2026-07-29T12:00:00");
    const day2 = new Date("2026-07-30T12:00:00");

    vi.setSystemTime(day1);
    touchAt(active, day1.getTime());
    rotateCodexLog(codexDir); // cold-start: file is today (day1) -> no roll
    expect(fs.existsSync(active)).toBe(true);

    vi.setSystemTime(day2);
    rotateCodexLog(codexDir); // steady-state: day advanced -> roll to <day1>
    expect(fs.existsSync(active)).toBe(false);
    expect(
      fs.existsSync(path.join(codexDir, "app-server-2026-07-29.log")),
    ).toBe(true);
  });
});
