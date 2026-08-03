import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  resolveCodexAcp,
  resolveClaudeAcp,
  resolveNodePackage,
  resolvePackageEntry,
  CODEX_ACP_PACKAGE,
  CODEX_ACP_ENTRY,
  CLAUDE_ACP_ENTRY,
  type EngineResolution,
} from "@nuwax-ai/agent-kit";
import type { ResolvedEngine } from "../src/core/engines/types.js";

const req = createRequire(import.meta.url);

// Compile-time guard: a nuwa-cli ResolvedEngine must be assignable to agent-kit's
// EngineResolution (the host reads command/args off the resolved engine; envOverlay
// is required on ResolvedEngine but optional on EngineResolution, so the host fills
// it). If this stops compiling, the two structs have drifted.
const _resolvedFitsEngineResolution: EngineResolution =
  null as unknown as ResolvedEngine;

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

  it("resolveCodexAcp honors entryOverride (nuwaclaw resources mode)", () => {
    const fake = "/fake/resources/nuwax-codex-acp-ts/dist/index.js";
    const r = resolveCodexAcp({ entryOverride: fake });
    expect(r.command).toBe(process.execPath);
    expect(r.args).toEqual([fake]);
  });

  it("resolveClaudeAcp honors a nuwaclaw bundled entry override", () => {
    expect(CLAUDE_ACP_ENTRY).toBe("claude-code-acp-ts/dist/index.js");
    const entry = "/fake/resources/claude-code-acp-ts/dist/index.js";
    expect(resolveClaudeAcp({ entryOverride: entry })).toEqual({
      command: process.execPath,
      args: [entry],
    });
  });

  it("resolveNodePackage centralizes node + entry spawn targets", () => {
    const entry = "/fake/resources/custom-acp/dist/index.js";
    expect(
      resolveNodePackage({
        packageName: "custom-acp",
        entrySpecifier: "custom-acp/dist/index.js",
        entryOverride: entry,
      }),
    ).toEqual({ command: process.execPath, args: [entry] });
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

  it("published CJS export is consumable via require — for nuwaclaw", () => {
    const mod = req("@nuwax-ai/agent-kit") as typeof import("@nuwax-ai/agent-kit");
    expect(typeof mod.resolveCodexAcp).toBe("function");
    expect(typeof mod.resolveClaudeAcp).toBe("function");
    const r = mod.resolveCodexAcp();
    expect(r.command).toBe(process.execPath);
    expect(r.args[0]).toMatch(
      /@nuwax-ai\/nuwax-codex-acp-ts\/dist\/index\.js$/,
    );
  });
});
