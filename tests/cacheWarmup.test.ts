import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const whichMocks = vi.hoisted(() => ({
  findOnPath: vi.fn(),
  isBatchShim: vi.fn(),
}));

vi.mock("../src/util/which.js", () => ({
  findOnPath: (...a: unknown[]) => whichMocks.findOnPath(...a),
  isBatchShim: (...a: unknown[]) => whichMocks.isBatchShim(...a),
}));

vi.mock("../src/core/debugLog.js", () => ({ debugLog: vi.fn() }));
vi.mock("../src/core/version.js", () => ({ CLI_VERSION: "1.0.0" }));

import * as cacheWarmup from "../src/core/mcp/cacheWarmup.js";

const npxDir = () => path.join(tmpHome, ".npm", "_npx");
const statePath = () =>
  path.join(tmpHome, ".nuwa-cli", "mcp-cache-warmup.json");

/** 构造一个「spawn 后即标记命中」的可控句柄集合，精确驱动 warmupOne 流程。 */
function makeSpawnThatCaches() {
  const cached = new Set<string>();
  const kill = vi.fn();
  const spawnNpx = vi.fn((spec: string) => {
    cached.add(cacheWarmup.pkgNameFromSpec(spec));
    return { kill, onClose: new Promise<number | null>(() => {}) };
  });
  const isCached = vi.fn((_dir: string, pkg: string) => cached.has(pkg));
  return { spawnNpx, isCached, kill };
}

let savedNpmCache: string | undefined;

describe("cacheWarmup", () => {
  beforeAll(() => {
    whichMocks.findOnPath.mockReturnValue("/usr/bin/npx");
    whichMocks.isBatchShim.mockReturnValue(false);
  });

  beforeEach(() => {
    tmpHome = path.join(
      os.tmpdir(),
      `nuwacli-warmup-${process.pid}-${Date.now()}`,
    );
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.mkdirSync(tmpHome, { recursive: true });
    savedNpmCache = process.env.NPM_CONFIG_CACHE;
    delete process.env.NPM_CONFIG_CACHE;
    whichMocks.findOnPath.mockReturnValue("/usr/bin/npx");
    whichMocks.isBatchShim.mockReturnValue(false);
  });

  afterEach(() => {
    if (savedNpmCache === undefined) delete process.env.NPM_CONFIG_CACHE;
    else process.env.NPM_CONFIG_CACHE = savedNpmCache;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("pkgNameFromSpec", () => {
    it("strips @latest but keeps @scope", () => {
      expect(cacheWarmup.pkgNameFromSpec("nuwax-ask-question-mcp@latest")).toBe(
        "nuwax-ask-question-mcp",
      );
      expect(cacheWarmup.pkgNameFromSpec("@nuwax-ai/openui-mcp@latest")).toBe(
        "@nuwax-ai/openui-mcp",
      );
      expect(cacheWarmup.pkgNameFromSpec("chrome-devtools-mcp@latest")).toBe(
        "chrome-devtools-mcp",
      );
    });
  });

  describe("isPackageInNpxCache", () => {
    it("returns true when package exists under any hash dir (incl scope)", () => {
      fs.mkdirSync(
        path.join(npxDir(), "h1", "node_modules", "@nuwax-ai", "openui-mcp"),
        { recursive: true },
      );
      expect(
        cacheWarmup.isPackageInNpxCache(npxDir(), "@nuwax-ai/openui-mcp"),
      ).toBe(true);
    });

    it("returns false when missing", () => {
      fs.mkdirSync(path.join(npxDir(), "h1", "node_modules"), {
        recursive: true,
      });
      expect(
        cacheWarmup.isPackageInNpxCache(npxDir(), "nuwax-ask-question-mcp"),
      ).toBe(false);
    });

    it("returns false when _npx does not exist", () => {
      expect(cacheWarmup.isPackageInNpxCache(npxDir(), "anything")).toBe(false);
    });
  });

  describe("resolveWarmupNpxCommand", () => {
    it("returns null when npx not on PATH", () => {
      whichMocks.findOnPath.mockReturnValue(null);
      expect(cacheWarmup.resolveWarmupNpxCommand()).toBeNull();
    });

    it("uses npx directly on non-windows", () => {
      whichMocks.findOnPath.mockReturnValue("/usr/bin/npx");
      whichMocks.isBatchShim.mockReturnValue(false);
      const cmd = cacheWarmup.resolveWarmupNpxCommand();
      expect(cmd).not.toBeNull();
      expect(cmd!.command).toBe("/usr/bin/npx");
      expect(cmd!.args("foo@latest")).toEqual(["-y", "foo@latest"]);
    });

    it("rewrites npx.cmd to node.exe + npx-cli.js on windows", () => {
      const npxCmd = path.join(tmpHome, "npx.cmd");
      whichMocks.findOnPath.mockReturnValue(npxCmd);
      whichMocks.isBatchShim.mockReturnValue(true);
      const npxCli = path.join(
        tmpHome,
        "node_modules",
        "npm",
        "bin",
        "npx-cli.js",
      );
      fs.mkdirSync(path.dirname(npxCli), { recursive: true });
      fs.writeFileSync(npxCli, "# fake");
      const cmd = cacheWarmup.resolveWarmupNpxCommand();
      expect(cmd).not.toBeNull();
      expect(cmd!.command).toBe(process.execPath);
      expect(cmd!.args("foo@latest")).toEqual([npxCli, "-y", "foo@latest"]);
    });

    it("returns null when npx.cmd sibling npx-cli.js missing", () => {
      whichMocks.findOnPath.mockReturnValue(path.join(tmpHome, "npx.cmd"));
      whichMocks.isBatchShim.mockReturnValue(true);
      expect(cacheWarmup.resolveWarmupNpxCommand()).toBeNull();
    });
  });

  describe("warmupMcpNpxCache", () => {
    it("skips when npx unavailable", async () => {
      whichMocks.findOnPath.mockReturnValue(null);
      const r = await cacheWarmup.warmupMcpNpxCache({ cliVersion: "1.0.0" });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe("npx unavailable");
    });

    it("warms up each package: spawns npx, kills after cache hit, writes state", async () => {
      const { spawnNpx, isCached, kill } = makeSpawnThatCaches();
      const r = await cacheWarmup.warmupMcpNpxCache({
        cliVersion: "1.0.0",
        spawnNpx,
        isCached,
        pollIntervalMs: 1,
        killGraceMs: 1,
      });
      expect(r.skipped).toBe(false);
      expect(r.warmed).toEqual([...cacheWarmup.MCP_WARMUP_SPECS]);
      expect(r.failed).toEqual([]);
      expect(spawnNpx).toHaveBeenCalledTimes(cacheWarmup.MCP_WARMUP_SPECS.length);
      expect(kill).toHaveBeenCalled();
      const state = JSON.parse(fs.readFileSync(statePath(), "utf8"));
      expect(state.cliVersion).toBe("1.0.0");
      expect(state.specs).toEqual([...cacheWarmup.MCP_WARMUP_SPECS]);
    });

    it("records failure on timeout (never cached)", async () => {
      const kill = vi.fn();
      const spawnNpx = vi.fn(
        () => ({ kill, onClose: new Promise<number | null>(() => {}) }),
      );
      const isCached = vi.fn(() => false);
      const r = await cacheWarmup.warmupMcpNpxCache({
        cliVersion: "1.0.0",
        spawnNpx,
        isCached,
        perPkgTimeoutMs: 10,
        pollIntervalMs: 2,
        killGraceMs: 1,
      });
      expect(r.skipped).toBe(false);
      expect(r.failed).toHaveLength(cacheWarmup.MCP_WARMUP_SPECS.length);
      expect(r.warmed).toEqual([]);
      expect(kill).toHaveBeenCalled();
      expect(fs.existsSync(statePath())).toBe(false);
    });

    it("skips (no spawn) when marker matches and all cached", async () => {
      const { spawnNpx } = makeSpawnThatCaches();
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(
        statePath(),
        JSON.stringify({
          cliVersion: "1.0.0",
          npxDir: npxDir(),
          specs: [...cacheWarmup.MCP_WARMUP_SPECS],
          warmedAt: 1,
        }),
      );
      const r = await cacheWarmup.warmupMcpNpxCache({
        cliVersion: "1.0.0",
        spawnNpx,
        isCached: () => true,
      });
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe("already warmed");
      expect(spawnNpx).not.toHaveBeenCalled();
    });

    it("self-heals when marker exists but cache was cleared", async () => {
      const { spawnNpx, isCached } = makeSpawnThatCaches();
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(
        statePath(),
        JSON.stringify({
          cliVersion: "1.0.0",
          npxDir: npxDir(),
          specs: [...cacheWarmup.MCP_WARMUP_SPECS],
          warmedAt: 1,
        }),
      );
      const r = await cacheWarmup.warmupMcpNpxCache({
        cliVersion: "1.0.0",
        spawnNpx,
        isCached,
        pollIntervalMs: 1,
        killGraceMs: 1,
      });
      expect(r.skipped).toBe(false);
      expect(spawnNpx).toHaveBeenCalled();
    });

    it("does not forward NPM_CONFIG_CACHE to spawn (align with runtime allowlist)", async () => {
      const previous = process.env.NPM_CONFIG_CACHE;
      process.env.NPM_CONFIG_CACHE = "/custom/cache";
      try {
        const seenEnv: NodeJS.ProcessEnv[] = [];
        const cached = new Set<string>();
        const spawnNpx = vi.fn((spec: string, env: NodeJS.ProcessEnv) => {
          seenEnv.push(env);
          cached.add(cacheWarmup.pkgNameFromSpec(spec));
          return {
            kill: vi.fn(),
            onClose: new Promise<number | null>(() => {}),
          };
        });
        const isCached = vi.fn((_d: string, pkg: string) => cached.has(pkg));
        const r = await cacheWarmup.warmupMcpNpxCache({
          cliVersion: "1.0.0",
          spawnNpx,
          isCached,
          pollIntervalMs: 1,
          killGraceMs: 1,
        });
        expect(r.skipped).toBe(false);
        expect(spawnNpx).toHaveBeenCalled();
        // 与运行时 mcp-proxy-ts getDefaultEnvironment() allowlist 对齐：不传 npm cache 指向
        for (const env of seenEnv) {
          expect(env.NPM_CONFIG_CACHE).toBeUndefined();
          expect(env.npm_config_cache).toBeUndefined();
        }
      } finally {
        if (previous === undefined) delete process.env.NPM_CONFIG_CACHE;
        else process.env.NPM_CONFIG_CACHE = previous;
      }
    });
  });
});
