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
import { findOnPath } from "../util/which.js";

export interface UiCommandOptions {
  port?: string;
  host?: string;
  engine?: string;
  cwd?: string;
  approve?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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
      }).unref();
      return;
    }
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    if (findOnPath(cmd)) {
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
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
    console.error(pc.red(`[nuwa-cli] --port 必须是 1-65535 的整数`));
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

  const { token, stop } = startUiHttp({
    port,
    host,
    engine: engineId,
    cwd,
    permissionMode,
    policyLabel,
    overlay,
  });

  const url = `http://${host}:${port}/?t=${token}`;
  console.log(pc.green(`nuwa-cli ui 已启动：${url}`));
  if (permissionMode === "yolo") {
    console.log(
      pc.yellow(
        `[nuwa-cli] 当前为自动批准（yolo）模式，工具调用将自动放行；敏感操作仍会在浏览器内弹出审批。`,
      ),
    );
  } else if (permissionMode === "ask") {
    console.log(
      pc.dim(
        `[nuwa-cli] ask 模式：每个工具调用都会在浏览器内弹出审批。`,
      ),
    );
  } else if (permissionMode === "deny-noninteractive") {
    console.log(
      pc.yellow(
        `[nuwa-cli] deny 模式：所有工具调用将被拒绝（仅可对话，无法写文件/执行命令）。`,
      ),
    );
  }
  console.log(pc.dim(`Ctrl+C 退出。`));

  if (options.open !== false) openBrowser(url);

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(pc.dim(`\n[nuwa-cli] 收到 ${sig}，关闭中...`));
    await stop().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
