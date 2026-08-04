import * as path from "node:path";
import { spawn } from "node:child_process";
import pc from "picocolors";
import { getEngine } from "../core/engines/registry.js";
import type { EngineKind } from "../core/env/inheritEnv.js";
import {
  parseApproveFlag,
  type PermissionMode,
} from "../core/permissions/policy.js";
import { startUiHttp } from "../core/ui/uiServer.js";
import { CLI_UI_PORT, findAvailablePort } from "../core/ports.js";
import { ensureDir, workspacesDir } from "../util/paths.js";
import { printShuttingDown } from "../util/ui.js";
import { t } from "../util/i18n/index.js";
import { findOnPath } from "../util/which.js";
import {
  registerProcess,
  updateProcessRecord,
} from "../core/processes/processRegistry.js";
import {
  acquireUiSingleton,
  releaseUiSingleton,
} from "../core/processes/uiSingleton.js";

export interface UiCommandOptions {
  port?: string;
  host?: string;
  engine?: string;
  cwd?: string;
  approve?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  force?: boolean;
  /** `--no-open` flips this to false so the browser isn't launched. */
  open?: boolean;
}

/** Cross-platform best-effort browser opener (no new dependency). */
function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    }
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    if (findOnPath(cmd)) {
      spawn(cmd, [url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
  } catch {
    // ignore — the startup URL is printed for manual opening
  }
}

export async function uiCommand(options: UiCommandOptions): Promise<void> {
  const engineId = (options.engine ?? "claude") as EngineKind;
  try {
    // Validates the id; a missing install is surfaced per-engine in the UI
    // (via /api/engines probe) rather than hard-failing here, so the user can
    // still open the dashboard and switch to whichever engine is available.
    getEngine(engineId);
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const cwd = path.resolve(options.cwd ?? workspacesDir());
  ensureDir(cwd);
  const host = options.host ?? "127.0.0.1";

  const preferredPort = options.port ? Number(options.port) : CLI_UI_PORT;
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 1 ||
    preferredPort > 65535
  ) {
    console.error(pc.red(t("ui.err.badPort")));
    process.exitCode = 1;
    return;
  }
  let port: number;
  try {
    port = await findAvailablePort(preferredPort, { host });
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const approveParsed = parseApproveFlag(options.approve);
  if (!approveParsed.ok) {
    console.error(pc.red(`[nuwa-cli] ${approveParsed.message}`));
    process.exitCode = 1;
    return;
  }
  const permissionMode: PermissionMode = approveParsed.mode;
  const policyLabel = `${approveParsed.approve} · ${permissionMode}`;
  const overlay =
    options.apiKey || options.baseUrl || options.model
      ? {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
        }
      : undefined;

  try {
    const replaced = await acquireUiSingleton(options.force === true);
    if (replaced.length > 0) {
      console.log(
        pc.yellow(t("ui.forceStopped", { pids: replaced.join(", ") })),
      );
    }
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  let httpHandle: ReturnType<typeof startUiHttp>;
  try {
    httpHandle = startUiHttp({
      port,
      host,
      engine: engineId,
      cwd,
      permissionMode,
      policyLabel,
      overlay,
    });
  } catch (err) {
    releaseUiSingleton();
    console.error(pc.red(t("ui.startFailed", { msg: (err as Error).message })));
    process.exitCode = 1;
    return;
  }
  const { token, server, stop } = httpHandle;
  registerProcess({
    pid: process.pid,
    kind: "ui",
    state: "starting",
    daemon: false,
    cwd,
    engine: engineId,
    host,
    port,
  });
  const markRunning = () =>
    updateProcessRecord(process.pid, { state: "running", host, port });
  if (server.listening) markRunning();
  else server.once("listening", markRunning);

  const url = `http://${host}:${port}/?t=${token}`;
  console.log(pc.green(t("ui.started", { url })));
  if (permissionMode === "yolo") {
    console.log(pc.yellow(t("ui.yolo")));
  } else if (permissionMode === "ask") {
    console.log(pc.dim(t("ui.askMode")));
  } else if (permissionMode === "deny-noninteractive") {
    console.log(pc.yellow(t("ui.denyMode")));
  }
  console.log(pc.dim(t("ui.ctrlCExit")));

  if (options.open !== false) openBrowser(url);

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    printShuttingDown(sig);
    await stop().catch(() => {});
    releaseUiSingleton();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("exit", () => {
    if (shuttingDown) return;
    releaseUiSingleton();
  });
}
