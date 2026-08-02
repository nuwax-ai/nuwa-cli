// @nuwax-ai/agent-kit — shared agent/ACP logic for nuwa-cli & nuwaclaw.
//
// First slice: engine (binary) resolution. The codex ACP adapter is resolved
// via require.resolve against the @nuwax-ai/nuwax-codex-acp-ts package, so both
// hosts converge on one strategy instead of one bundling it and the other
// npm-resolving it.

import { createRequire } from "node:module";

// createRequire(import.meta.url) gives a require whose resolution is anchored
// to this module — correct under ESM (native import.meta.url). Under CJS,
// tsup's `shims: true` provides a compatible import.meta.url (based on
// __filename), so the same source works for both build outputs without a
// runtime `typeof require` branch (which misfires on Node 22+ ESM).
const runtimeRequire = createRequire(import.meta.url);

/**
 * Resolve an installed package's entry specifier (e.g.
 * "@nuwax-ai/nuwax-codex-acp-ts/dist/index.js") to an absolute path via
 * `require.resolve`. Safe under both ESM (createRequire) and CJS (esbuild
 * rewrites import.meta.url for the cjs build). Throws a friendly error if the
 * dependency is missing — callers should hint `npm install`.
 */
export function resolvePackageEntry(
  packageName: string,
  entrySpecifier: string,
): string {
  try {
    return runtimeRequire.resolve(entrySpecifier);
  } catch {
    throw new Error(
      `缺少 ${packageName} 依赖入口 ${entrySpecifier}。请重新运行 npm install。`,
    );
  }
}

/** A resolved engine spawn target — structurally compatible with nuwa-cli's
 *  `ResolvedEngine`, so hosts can assign directly. */
export interface EngineResolution {
  command: string;
  args: string[];
  envOverlay?: NodeJS.ProcessEnv;
}

export const CODEX_ACP_PACKAGE = "@nuwax-ai/nuwax-codex-acp-ts";
export const CODEX_ACP_ENTRY = `${CODEX_ACP_PACKAGE}/dist/index.js`;

/**
 * Resolve the codex ACP adapter to a spawn target: `node <entry>`, where entry
 * is require.resolve'd from @nuwax-ai/nuwax-codex-acp-ts. Host-specific env
 * (e.g. nuwa-cli's CODEX_LOG_DIR) is left for the caller to overlay on
 * `envOverlay`.
 */
export function resolveCodexAcp(): EngineResolution {
  const entry = resolvePackageEntry(CODEX_ACP_PACKAGE, CODEX_ACP_ENTRY);
  return {
    command: process.execPath,
    args: [entry],
  };
}

// Health-check primitives (file-server / lanproxy polling, envelope判定,
// process liveness) shared with nuwaclaw. See ./health.ts.
export * from "./health.js";
