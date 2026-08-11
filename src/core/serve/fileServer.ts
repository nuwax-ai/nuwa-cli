import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS,
  waitForFileServerHealth as kitWaitForFileServerHealth,
  withStartRetry,
  type StartRetryLogger,
} from "@nuwax-ai/agent-kit";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import { ensureDir, logsDir, tmpDir, workspacesDir } from "../../util/paths.js";
import { registerProcess, unregisterProcess } from "../processes/processRegistry.js";

const NUWAX_FILE_SERVER_ENTRY = "nuwax-file-server/dist/cli.js";

/**
 * 本进程内按 port 记住最近一次 start 登记的 pid。
 * stop / 重试前必须 unregister，否则 withStartRetry 会堆出失效 registry 记录。
 */
const startedPidsByPort = new Map<number, number>();

function forgetRegisteredPid(port: number): void {
  const pid = startedPidsByPort.get(port);
  if (pid === undefined) return;
  unregisterProcess(pid);
  startedPidsByPort.delete(port);
}

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
  // 同 port 再次 start（重试）前清掉旧 registry，避免 PID 堆积
  forgetRegisteredPid(port);
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  if (proc.pid) {
    startedPidsByPort.set(port, proc.pid);
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
    forgetRegisteredPid(port);
    return;
  }
  spawnSync(process.execPath, [bin, "stop"], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
    windowsHide: true,
  });
  // CLI stop 成功与否都清 registry：进程要么已停，要么应由下次 list 扫掉僵死记录
  forgetRegisteredPid(port);
}

/**
 * 轮询 file-server GET /health，直到 status===ok、超时或 signal abort。
 * 实现已抽进 @nuwax-ai/agent-kit（与 nuwaclaw 共用）；这里保留原签名返回
 * boolean，serve.ts 调用处不变。
 *
 * 默认超时跟 kit 对齐（20s），覆盖 Windows 冷启；调用方可缩短（测试）。
 * @param signal 可选；serve shutdown 时 abort，避免 Ctrl+C 后仍卡满 timeoutMs。
 */
export async function waitForFileServerHealth(
  port: number,
  timeoutMs = DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS,
  intervalMs = 200,
  signal?: AbortSignal,
): Promise<boolean> {
  return (
    await kitWaitForFileServerHealth({ port, timeoutMs, intervalMs, signal })
  ).healthy;
}

export interface BringUpFileServerOptions {
  port: number;
  baseWorkspaceDir?: string;
  /** 单次健康轮询预算；默认 kit 的 20s。 */
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  logger?: StartRetryLogger;
  /** 完整启动最大次数（含首次）；默认 kit 的 3。 */
  maxAttempts?: number;
  /** 失败后的 backoff；默认 1s/2s/4s。测试可传 [0,0]。 */
  backoffMs?: readonly number[];
  /**
   * 每次成功 spawn 后回调（含重试）。serve 用它立刻标记 fileServerStarted，
   * 以便健康等待期间 SIGINT 仍能 stop 掉 detached 进程。
   */
  onStarted?: () => void;
}

/**
 * 完整拉起 file-server：spawn → /health，失败则 stop 后按 agent-kit
 * withStartRetry 再试（默认 3 次、1s/2s/4s backoff），与 Electron ServiceManager 对齐。
 */
export async function bringUpFileServer(
  options: BringUpFileServerOptions,
): Promise<boolean> {
  const {
    port,
    baseWorkspaceDir,
    timeoutMs = DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS,
    intervalMs = 200,
    signal,
    logger,
    maxAttempts,
    backoffMs,
    onStarted,
  } = options;

  const result = await withStartRetry(
    async () => {
      if (signal?.aborted) {
        return { success: false, error: "FileServer start aborted" };
      }

      // 上一轮失败可能留下僵尸 / 半就绪进程，先 stop 再 spawn，避免假成功
      stopFileServer(port, baseWorkspaceDir);
      startFileServer(port, baseWorkspaceDir);
      onStarted?.();

      const healthy = await waitForFileServerHealth(
        port,
        timeoutMs,
        intervalMs,
        signal,
      );
      if (signal?.aborted) {
        stopFileServer(port, baseWorkspaceDir);
        return { success: false, error: "FileServer start aborted" };
      }
      if (!healthy) {
        stopFileServer(port, baseWorkspaceDir);
        return {
          success: false,
          error: `FileServer health check failed (timeoutMs=${timeoutMs})`,
        };
      }
      return { success: true };
    },
    { label: "FileServer", signal, logger, maxAttempts, backoffMs },
  );

  return result.success;
}
