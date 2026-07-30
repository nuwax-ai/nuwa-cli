import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import writeAtomicLib from "write-file-atomic";

export function nuwaCliHome(): string {
  return path.join(os.homedir(), ".nuwa-cli");
}

export function cliDir(): string {
  return nuwaCliHome();
}

export function cliConfigPath(): string {
  return path.join(cliDir(), "config.json");
}

export function cliCredentialsPath(): string {
  return path.join(cliDir(), "credentials.json");
}

export function cliToolsDir(): string {
  return path.join(cliDir(), "tools");
}

/**
 * Lockfile `serve` writes on listen and removes on graceful shutdown, so
 * `status` can report whether a local serve is running and on which port.
 * Holds only pid/port/host/startedAt — NEVER the X-Nuwax-Internal-Secret
 * (that stays ephemeral, printed at startup only). `NUWACLI_SERVE_LOCK_PATH`
 * is a test-only override so the suite doesn't clobber a real serve's lock.
 */
export function cliServeLockPath(): string {
  return (
    process.env.NUWACLI_SERVE_LOCK_PATH ?? path.join(cliDir(), "serve.lock")
  );
}

/** Per-process runtime records used by `nuwa-cli ps`. */
export function cliProcessesDir(): string {
  return (
    process.env.NUWACLI_PROCESS_DIR ?? path.join(cliDir(), "processes")
  );
}

export function cliServeGuardPath(): string {
  return (
    process.env.NUWACLI_SERVE_GUARD_PATH ?? path.join(cliDir(), "serve.guard")
  );
}

export function cliUiGuardPath(): string {
  return process.env.NUWACLI_UI_GUARD_PATH ?? path.join(cliDir(), "ui.guard");
}

export function enginesDir(): string {
  return path.join(nuwaCliHome(), "engines");
}

export function logsDir(): string {
  return path.join(nuwaCliHome(), "logs");
}

/**
 * Directory the codex ACP adapter (`nuwax-codex-acp-ts`) writes its full
 * stderr/stdout log to (as `app-server.log`) once we set `CODEX_LOG_DIR` on
 * the spawned engine. Kept under the nuwa-cli logs dir so a codex engine-start
 * failure's underlying cause is captured in full instead of the adapter's
 * ≤2KB stderr tail.
 */
export function codexLogDir(): string {
  return path.join(logsDir(), "codex");
}

export function tmpDir(): string {
  return path.join(nuwaCliHome(), "tmp");
}

export function workspacesDir(): string {
  return path.join(nuwaCliHome(), "workspaces");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileAtomic(
  filePath: string,
  data: string,
  mode?: number,
): void {
  ensureDir(path.dirname(filePath));
  writeAtomicLib.sync(filePath, data, mode !== undefined ? { mode } : {});
}
