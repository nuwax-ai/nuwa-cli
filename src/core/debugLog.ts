import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, logsDir, todayDateStr } from "../util/paths.js";
import { runLogMaintenance } from "./logSweep.js";

const SECRET_KEYS = [
  "apiKey",
  "api_key",
  "authorization",
  "configKey",
  "password",
  "savedKey",
  "secret",
  "token",
];

const LATEST_LOG_FILENAME = "latest.log";

let initialized = false;
let cleanupTimer: NodeJS.Timeout | undefined;
let lastLinkedDate = "";

function activeMainLogPath(): string {
  return path.join(logsDir(), `main.${todayDateStr()}.log`);
}

function linkOrCopy(targetPath: string, linkPath: string): void {
  try {
    try {
      fs.lstatSync(linkPath);
      fs.unlinkSync(linkPath);
    } catch {
      // Missing link is fine.
    }
    if (process.platform === "win32") {
      fs.linkSync(targetPath, linkPath);
    } else {
      fs.symlinkSync(path.basename(targetPath), linkPath, "file");
    }
  } catch {
    try {
      fs.copyFileSync(targetPath, linkPath);
    } catch {
      // Best-effort compatibility entry.
    }
  }
}

function updateLogLinks(): void {
  if (process.env.NUWACLI_DEBUG_LOG_PATH) return;
  const date = todayDateStr();
  if (date === lastLinkedDate) return;
  const dir = logsDir();
  const target = activeMainLogPath();
  ensureDir(dir);
  if (!fs.existsSync(target)) fs.closeSync(fs.openSync(target, "a"));
  linkOrCopy(target, path.join(dir, LATEST_LOG_FILENAME));
  lastLinkedDate = date;
}

export function initDebugLogging(): void {
  if (initialized) return;
  initialized = true;
  ensureDir(logsDir());
  updateLogLinks();
  runLogMaintenance();
  cleanupTimer = setInterval(runLogMaintenance, 60 * 60 * 1000);
  cleanupTimer.unref?.();
  process.once("exit", () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
  });
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      SECRET_KEYS.some((needle) =>
        key.toLowerCase().includes(needle.toLowerCase()),
      )
    ) {
      redacted[key] =
        typeof item === "string" || (item && typeof item === "object")
          ? "(redacted)"
          : item;
    } else {
      redacted[key] = redact(item);
    }
  }
  return redacted;
}

export function debugLogPath(): string {
  return process.env.NUWACLI_DEBUG_LOG_PATH ?? activeMainLogPath();
}

export function debugLog(
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    initDebugLogging();
    updateLogLinks();
    const filePath = debugLogPath();
    ensureDir(path.dirname(filePath));
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        scope,
        message,
        ...(meta ? { meta: redact(meta) } : {}),
      }) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
  } catch {
    // Debug logging must never break CLI control flow.
  }
}
