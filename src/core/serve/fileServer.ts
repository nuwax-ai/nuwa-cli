import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import { ensureDir, logsDir, tmpDir, workspacesDir } from "../../util/paths.js";
import { registerProcess } from "../processes/processRegistry.js";
import { waitForFileServerHealth as kitWaitForFileServerHealth } from "@nuwax-ai/agent-kit";

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
  const uploadProjectDir = path.join(tmpDir(), "file-server-project-zips");
  const distTargetDir = path.join(tmpDir(), "file-server-dist");
  const projectLogDir = path.join(logsDir(), "file-server", "project_logs");
  const computerLogDir = path.join(logsDir(), "file-server", "computer_logs");
  ensureDir(dir);
  ensureDir(workspaceBase);
  ensureDir(projectSourceDir);
  ensureDir(uploadProjectDir);
  ensureDir(distTargetDir);
  ensureDir(projectLogDir);
  ensureDir(computerLogDir);
  return buildCliChildEnv({
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    COMPUTER_WORKSPACE_DIR: workspaceBase,
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
    windowsHide: true,
  });
}

/**
 * 轮询 file-server GET /health，直到 status===ok、超时或 signal abort。
 * 实现已抽进 @nuwax-ai/agent-kit（与 nuwaclaw 共用）；这里保留原签名返回
 * boolean，serve.ts 调用处不变。
 * @param signal 可选；serve shutdown 时 abort，避免 Ctrl+C 后仍卡满 timeoutMs。
 */
export async function waitForFileServerHealth(
  port: number,
  timeoutMs = 10_000,
  intervalMs = 200,
  signal?: AbortSignal,
): Promise<boolean> {
  return (
    await kitWaitForFileServerHealth({ port, timeoutMs, intervalMs, signal })
  ).healthy;
}
