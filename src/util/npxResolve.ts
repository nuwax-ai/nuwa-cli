import * as fs from "node:fs";
import * as path from "node:path";
import { findOnPath, isBatchShim } from "./which.js";

export interface ResolvedInvocation {
  command: string;
  args: string[];
}

/**
 * On Windows, `npx` is a `.cmd` shim; spawning it flashes a cmd.exe console even
 * with `windowsHide: true` (see nuwaclaw agent-electron-client `spawnNoWindow`).
 * Resolve an `npx`/`npx.cmd` invocation to `node + npx-cli.js` so callers spawn
 * node directly — the same trick `cacheWarmup.resolveWarmupNpxCommand` and
 * `update.resolvePackageManagerInvocation` already use for npm.
 *
 * Returns `null` when no rewrite applies (non-Windows, npx not on PATH, npx is
 * already a real binary rather than a `.cmd` shim, or `npx-cli.js` can't be
 * located next to it) so callers fall back to the original command unchanged.
 */
export function resolveNpxInvocation(
  args: string[],
): ResolvedInvocation | null {
  if (process.platform !== "win32") return null;
  const npxPath = findOnPath("npx");
  if (!npxPath || !isBatchShim(npxPath)) return null;
  const npxCli = path.join(
    path.dirname(npxPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  if (!fs.existsSync(npxCli)) return null;
  return { command: process.execPath, args: [npxCli, ...args] };
}

/**
 * Resolve an MCP stdio command away from the `npx` shim when possible.
 * Returns the (possibly rewritten) `{command, args}`. Non-npx commands and all
 * non-Windows platforms pass through unchanged.
 */
export function resolveStdioNoWindow(
  command: string,
  args: string[] = [],
): ResolvedInvocation {
  const base = command.trim().toLowerCase();
  if (base === "npx" || base === "npx.cmd") {
    const resolved = resolveNpxInvocation(args);
    if (resolved) return resolved;
  }
  return { command, args };
}
