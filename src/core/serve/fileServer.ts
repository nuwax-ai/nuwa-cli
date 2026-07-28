import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import { ensureDir, logsDir, tmpDir, workspacesDir } from "../../util/paths.js";
import { registerProcess } from "../processes/processRegistry.js";

const NUWAX_FILE_SERVER_ENTRY = "nuwax-file-server/dist/cli.js";

function resolveFileServerBin(): string {
  return resolveInstalledPackageEntry(
    "nuwax-file-server",
    NUWAX_FILE_SERVER_ENTRY,
  );
}

export function buildFileServerEnv(
  port: number,
  baseWorkspaceDir = workspacesDir(),
): NodeJS.ProcessEnv {
  const dir = path.join(tmpDir(), `file-server-${port}`);
  const workspaceBase = path.resolve(baseWorkspaceDir);
  const projectSourceDir = path.join(workspaceBase, "project_workspace");
  const computerWorkspaceDir = path.join(
    workspaceBase,
    "computer-project-workspace",
  );
  const uploadProjectDir = path.join(tmpDir(), "file-server-project-zips");
  const distTargetDir = path.join(tmpDir(), "file-server-dist");
  const projectLogDir = path.join(logsDir(), "file-server", "project_logs");
  const computerLogDir = path.join(logsDir(), "file-server", "computer_logs");
  ensureDir(dir);
  ensureDir(workspaceBase);
  ensureDir(projectSourceDir);
  ensureDir(computerWorkspaceDir);
  ensureDir(uploadProjectDir);
  ensureDir(distTargetDir);
  ensureDir(projectLogDir);
  ensureDir(computerLogDir);
  return buildCliChildEnv({
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    COMPUTER_WORKSPACE_DIR: computerWorkspaceDir,
    PROJECT_SOURCE_DIR: projectSourceDir,
    UPLOAD_PROJECT_DIR: uploadProjectDir,
    DIST_TARGET_DIR: distTargetDir,
    LOG_BASE_DIR: projectLogDir,
    COMPUTER_LOG_DIR: computerLogDir,
  });
}

export function startFileServer(port: number, baseWorkspaceDir?: string): void {
  const bin = resolveFileServerBin();
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  if (proc.pid) {
    registerProcess({
      pid: proc.pid,
      kind: "file-server",
      state: "running",
      daemon: true,
      cwd: process.cwd(),
      port,
    });
  }
  proc.unref();
}

export function stopFileServer(port: number, baseWorkspaceDir?: string): void {
  let bin: string;
  try {
    bin = resolveFileServerBin();
  } catch {
    return;
  }
  spawnSync(process.execPath, [bin, "stop"], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
  });
}

/** 可被 AbortSignal 打断的 sleep；abort 时立即结束，不抛错。 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 轮询 file-server GET /health，直到 status===ok、超时或 signal abort。
 * @param signal 可选；serve shutdown 时 abort，避免 Ctrl+C 后仍卡满 timeoutMs。
 */
export async function waitForFileServerHealth(
  port: number,
  timeoutMs = 10_000,
  intervalMs = 200,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) return false;
    try {
      // 单次请求超时 + 外部 abort（shutdown）任一触发即结束本次 fetch
      const requestSignal = signal
        ? AbortSignal.any([AbortSignal.timeout(1500), signal])
        : AbortSignal.timeout(1500);
      const res = await fetch(url, { signal: requestSignal });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body?.status === "ok") return true;
      }
    } catch {
      // not ready / aborted；若已 abort 则下面直接 return false
    }
    if (signal?.aborted) return false;
    await delay(intervalMs, signal);
  } while (Date.now() < deadline);
  return false;
}
