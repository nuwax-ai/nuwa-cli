import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("workspaces command", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-ws-test-"));
    vi.resetModules();
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): void {
    const full = path.join(tmpHome, ".nuwa-cli", "workspaces", rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it("lists projects grouped by user with a total count", async () => {
    writeFile("100/p1/a.txt", "hello");
    writeFile("100/p1/b.txt", "world!!");
    writeFile("100/p2/nested/c.txt", "x");
    const { workspacesCommand } = await import(
      "../src/commands/workspaces.js"
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await workspacesCommand({});
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("Workspaces");
    expect(out).toContain("User 100");
    expect(out).toContain("p1");
    expect(out).toContain("p2");
    expect(out).toContain("2 project directories in total");
    logSpy.mockRestore();
  });

  it("outputs JSON with --json including root and projects", async () => {
    writeFile("100/p1/a.txt", "hello");
    const { workspacesCommand } = await import(
      "../src/commands/workspaces.js"
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await workspacesCommand({ json: true });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.root).toContain("workspaces");
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]).toMatchObject({
      user: "100",
      project: "p1",
      fileCount: 1,
    });
    expect(parsed.projects[0].totalSize).toBe(5); // "hello"
    logSpy.mockRestore();
  });

  it("filters by --user", async () => {
    writeFile("100/p1/a.txt", "a");
    writeFile("200/p2/b.txt", "b");
    const { workspacesCommand } = await import(
      "../src/commands/workspaces.js"
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await workspacesCommand({ user: "200" });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("User 200");
    expect(out).toContain("p2");
    expect(out).not.toContain("p1");
    expect(out).toContain("1 project directories in total");
    logSpy.mockRestore();
  });

  it("prints a file tree with --long (dirs first)", async () => {
    writeFile("100/p1/sub/c.txt", "x");
    writeFile("100/p1/a.txt", "y");
    const { workspacesCommand } = await import(
      "../src/commands/workspaces.js"
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await workspacesCommand({ long: true });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("a.txt");
    expect(out).toContain("sub/");
    expect(out).toContain("c.txt");
    logSpy.mockRestore();
  });

  it("handles an empty workspace gracefully", async () => {
    const { workspacesCommand } = await import(
      "../src/commands/workspaces.js"
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await workspacesCommand({});
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("No workspace directories");
    logSpy.mockRestore();
  });
});
