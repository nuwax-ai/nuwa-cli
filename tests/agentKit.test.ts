import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  resolveCodexAcp,
  resolvePackageEntry,
  CODEX_ACP_PACKAGE,
  CODEX_ACP_ENTRY,
  type EngineResolution,
} from "@nuwax-ai/agent-kit";

const req = createRequire(import.meta.url);

describe("@nuwax-ai/agent-kit — codex engine resolution", () => {
  it("resolveCodexAcp returns node + the codex-acp-ts adapter entry", () => {
    const r: EngineResolution = resolveCodexAcp();
    expect(r.command).toBe(process.execPath);
    expect(r.args).toHaveLength(1);
    // entry is require.resolve("@nuwax-ai/nuwax-codex-acp-ts/dist/index.js")
    expect(r.args[0]).toMatch(
      /@nuwax-ai\/nuwax-codex-acp-ts\/dist\/index\.js$/,
    );
    // envOverlay left for the host to fill (nuwa-cli adds CODEX_LOG_DIR).
    expect(r.envOverlay).toBeUndefined();
  });

  it("resolvePackageEntry resolves a real installed entry", () => {
    const entry = resolvePackageEntry(CODEX_ACP_PACKAGE, CODEX_ACP_ENTRY);
    expect(entry).toBe(
      req.resolve("@nuwax-ai/nuwax-codex-acp-ts/dist/index.js"),
    );
  });

  it("resolvePackageEntry throws a friendly message on a missing entry", () => {
    expect(() =>
      resolvePackageEntry("no-such-pkg", "no-such-pkg/missing.js"),
    ).toThrow(/缺少 no-such-pkg/);
  });

  it("CJS build (dist/index.cjs) is consumable via require — for nuwaclaw", () => {
    // The CJS output must load and work under require() (nuwaclaw is CJS/Electron).
    // This is the whole point of the dual-format build.
    const cjsPath = fileURLToPath(
      new URL("../packages/agent-kit/dist/index.cjs", import.meta.url),
    );
    const mod = req(cjsPath) as typeof import("@nuwax-ai/agent-kit");
    expect(typeof mod.resolveCodexAcp).toBe("function");
    const r = mod.resolveCodexAcp();
    expect(r.command).toBe(process.execPath);
    expect(r.args[0]).toMatch(
      /@nuwax-ai\/nuwax-codex-acp-ts\/dist\/index\.js$/,
    );
  });
});
