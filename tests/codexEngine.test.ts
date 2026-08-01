import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: vi
    .fn()
    .mockReturnValue("/fake/nuwax-codex-acp.js"),
}));

describe("codexEngine.resolve", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-codex-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Re-import both the engine and the (mocked) resolver fresh after
  // resetModules so each test observes its own mock call history.
  async function load() {
    const { codexEngine } = await import("../src/core/engines/codex.js");
    const { resolveInstalledPackageEntry } = await import(
      "../src/core/engines/packageResolve.js"
    );
    return { codexEngine, resolveInstalledPackageEntry };
  }

  it("resolves the @nuwax-ai/nuwax-codex-acp-ts adapter entry", async () => {
    const { codexEngine, resolveInstalledPackageEntry } = await load();
    const resolved = await codexEngine.resolve();
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args).toEqual(["/fake/nuwax-codex-acp.js"]);
    expect(resolveInstalledPackageEntry).toHaveBeenCalledWith(
      "@nuwax-ai/nuwax-codex-acp-ts",
      "@nuwax-ai/nuwax-codex-acp-ts/dist/index.js",
    );
  });

  it("points the adapter log dir at codexLogDir() so engine-start failures are captured", async () => {
    const { codexEngine } = await load();
    const resolved = await codexEngine.resolve();
    expect(resolved.envOverlay?.CODEX_LOG_DIR).toBeTruthy();
  });
});
