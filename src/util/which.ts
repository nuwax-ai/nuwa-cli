import { spawnSync } from "node:child_process";
import which from "which";

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function isBatchShim(command: string): boolean {
  return isWindows() && /\.(cmd|bat)$/i.test(command);
}

/** Resolve a command to an absolute path via the shell's own lookup (which/where). */
export function findOnPath(command: string): string | null {
  try {
    return which.sync(command) ?? null;
  } catch {
    return null;
  }
}

export function getVersion(
  binPath: string,
  args: string[] = ["--version"],
): string | null {
  const result = spawnSync(binPath, args, {
    encoding: "utf-8",
    timeout: 5000,
    ...(isBatchShim(binPath) ? { shell: true } : {}),
  });
  if (result.status !== 0) return null;
  const text = (result.stdout || result.stderr || "").trim();
  const match = text.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : text.split("\n")[0]?.trim() || null;
}
