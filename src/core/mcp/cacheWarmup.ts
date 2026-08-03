/**
 * nuwa-cli adapter for the shared MCP npx cache warmup state machine.
 *
 * @nuwax-ai/agent-kit owns cache discovery, idempotency, serial warming,
 * timeout and process cleanup. This module owns CLI-specific PATH resolution,
 * environment sanitising, marker persistence and logging.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MCP_WARMUP_KILL_GRACE_MS,
  MCP_WARMUP_PER_PKG_TIMEOUT_MS,
  MCP_WARMUP_POLL_INTERVAL_MS,
  MCP_WARMUP_SPECS,
  isPackageInNpxCache,
  packageNameFromSpec,
  runMcpCacheWarmup,
  type McpCacheWarmupResult,
  type McpCacheWarmupSpawn,
  type McpCacheWarmupState,
} from "@nuwax-ai/agent-kit";
import { debugLog } from "../debugLog.js";
import { CLI_VERSION } from "../version.js";
import { nuwaCliHome, writeFileAtomic } from "../../util/paths.js";
import { findOnPath, isBatchShim } from "../../util/which.js";

export {
  MCP_WARMUP_PER_PKG_TIMEOUT_MS,
  MCP_WARMUP_POLL_INTERVAL_MS,
  MCP_WARMUP_SPECS,
  isPackageInNpxCache,
};

/** Historical host export kept as a compatibility alias. */
export const pkgNameFromSpec = packageNameFromSpec;

const WARMUP_STATE_FILENAME = "mcp-cache-warmup.json";

export type McpCacheWarmupOptions = {
  spawnNpx?: McpCacheWarmupSpawn;
  isCached?: (npxDir: string, pkgName: string) => boolean;
  now?: () => number;
  cliVersion?: string;
  perPkgTimeoutMs?: number;
  pollIntervalMs?: number;
  killGraceMs?: number;
  force?: boolean;
};

export type { McpCacheWarmupResult };

/** Resolve the npx invocation that matches the runtime cache semantics. */
export function resolveWarmupNpxCommand(): {
  command: string;
  args: (spec: string) => string[];
} | null {
  const npxPath = findOnPath("npx");
  if (!npxPath) return null;
  if (!isBatchShim(npxPath)) {
    return { command: npxPath, args: (spec) => ["-y", spec] };
  }
  const npxCli = path.join(
    path.dirname(npxPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  if (!fs.existsSync(npxCli)) return null;
  return { command: process.execPath, args: (spec) => [npxCli, "-y", spec] };
}

function buildWarmupEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NUWACLI_PASSWORD;
  delete env.NUWAX_CONFIG_KEY;
  delete env.NUWAX_SAVED_KEY;
  delete env.NUWACLI_SERVE_LOCK_PATH;
  delete env.NPM_CONFIG_CACHE;
  delete env.npm_config_cache;
  return env;
}

function getNpxCacheDir(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.NPM_CONFIG_CACHE || path.join(os.homedir(), ".npm");
  return path.join(cacheRoot, "_npx");
}

type CliWarmupState = {
  cliVersion: string;
  npxDir: string;
  specs: string[];
  warmedAt: number;
};

function getWarmupStatePath(): string {
  return path.join(nuwaCliHome(), WARMUP_STATE_FILENAME);
}

function readWarmupState(): McpCacheWarmupState | null {
  try {
    const statePath = getWarmupStatePath();
    if (!fs.existsSync(statePath)) return null;
    const data = JSON.parse(
      fs.readFileSync(statePath, "utf8"),
    ) as Partial<CliWarmupState>;
    if (
      typeof data.cliVersion !== "string" ||
      typeof data.npxDir !== "string" ||
      !Array.isArray(data.specs)
    ) {
      return null;
    }
    return {
      version: data.cliVersion,
      npxDir: data.npxDir,
      specs: data.specs,
      warmedAt: typeof data.warmedAt === "number" ? data.warmedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeWarmupState(state: McpCacheWarmupState): void {
  try {
    const cliState: CliWarmupState = {
      cliVersion: state.version,
      npxDir: state.npxDir,
      specs: state.specs,
      warmedAt: state.warmedAt,
    };
    writeFileAtomic(getWarmupStatePath(), JSON.stringify(cliState));
  } catch (error) {
    debugLog("serve.warmup", "state-write-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createDefaultSpawn(command: {
  command: string;
  args: (spec: string) => string[];
}): McpCacheWarmupSpawn {
  return (spec, env) => {
    const child = spawn(command.command, command.args(spec), {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    const onClose = new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code));
      child.on("error", () => resolve(null));
    });
    return { kill: (signal) => child.kill(signal), onClose };
  };
}

/** Serve-start background warmup. Best-effort; never throws. */
export async function warmupMcpNpxCache(
  options?: McpCacheWarmupOptions,
): Promise<McpCacheWarmupResult> {
  const env = buildWarmupEnv();
  const npxDir = getNpxCacheDir(env);
  const command = resolveWarmupNpxCommand();
  const spawnNpx = command
    ? (options?.spawnNpx ?? createDefaultSpawn(command))
    : null;

  return runMcpCacheWarmup({
    version: options?.cliVersion ?? CLI_VERSION,
    npxDir,
    env,
    spawnNpx,
    readState: readWarmupState,
    writeState: writeWarmupState,
    isCached: options?.isCached,
    now: options?.now,
    perPackageTimeoutMs:
      options?.perPkgTimeoutMs ?? MCP_WARMUP_PER_PKG_TIMEOUT_MS,
    pollIntervalMs:
      options?.pollIntervalMs ?? MCP_WARMUP_POLL_INTERVAL_MS,
    killGraceMs: options?.killGraceMs ?? MCP_WARMUP_KILL_GRACE_MS,
    force: options?.force,
    onDone: (result) => {
      debugLog("serve.warmup", "done", {
        skipped: result.skipped,
        warmed: result.warmed.length,
        failed: result.failed.length,
        failedSpecs: result.failed.length
          ? result.failed.map((failure) => failure.spec)
          : undefined,
      });
    },
  });
}
