import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import pc from "picocolors";
import { getEngine } from "../core/engines/registry.js";
import { buildCliChildEnv, type EngineKind } from "../core/env/inheritEnv.js";
import {
  parseApproveFlag,
  type PermissionMode,
} from "../core/permissions/policy.js";
import { startServeHttp } from "../core/serve/server.js";
import {
  startFileServer,
  stopFileServer,
  waitForFileServerHealth,
} from "../core/serve/fileServer.js";
import {
  startLanproxy,
  confirmLanproxyHealthy,
  waitForLanproxyTunnel,
  type LanproxyHandle,
} from "../core/serve/lanproxyProcess.js";
import {
  readCredentials,
  rememberAccountCredentials,
  updateCredentials,
} from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";
import {
  registerClient,
  defaultSandboxValue,
  RegError,
} from "../core/auth/regClient.js";
import {
  CLI_AGENT_PORT,
  CLI_FILE_SERVER_PORT,
  findAvailablePort,
} from "../core/ports.js";
import {
  ensureDir,
  logsDir,
  workspacesDir,
  serveLogPath,
} from "../util/paths.js";
import { printShuttingDown, withSpinner } from "../util/ui.js";
import { t } from "../util/i18n/index.js";
import { debugLog } from "../core/debugLog.js";
import { warmupMcpNpxCache } from "../core/mcp/cacheWarmup.js";
import {
  registerProcess,
  updateProcessRecord,
} from "../core/processes/processRegistry.js";
import {
  acquireServeSingleton,
  releaseServeSingleton,
  transferServeSingleton,
  waitForDaemonGuardHandoff,
} from "../core/processes/serveSingleton.js";

export interface ServeCommandOptions {
  port?: string;
  host?: string;
  engine: string;
  cwd?: string;
  approve?: string;
  tunnel?: boolean;
  lanproxyPath?: string;
  lanproxyHost?: string;
  lanproxyPort?: string;
  lanproxySsl?: string;
  daemon?: boolean;
  force?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  daemonArgs?: string[];
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(t("serve.err.badBool", { value }));
}

function parsePortOption(
  value: string | undefined,
  defaultValue: number,
  optionName: string,
): number {
  if (value === undefined) return defaultValue;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(t("serve.err.badPort", { option: optionName, value }));
  }
  return port;
}

async function resolveAvailablePort(
  preferredPort: number,
  host: string,
  label: string,
  exclude: number[] = [],
): Promise<number> {
  const port = await findAvailablePort(preferredPort, { host, exclude });
  if (port !== preferredPort) {
    console.error(
      pc.yellow(
        t("serve.portTaken", {
          label,
          preferred: preferredPort,
          port,
        }),
      ),
    );
  }
  return port;
}

function launchDaemon(argsOverride?: string[]): number {
  const args =
    argsOverride ?? process.argv.slice(1).filter((arg) => arg !== "--daemon");
  ensureDir(logsDir());
  const logPath = serveLogPath();
  // Windows：无 BOM 时 Get-Content 默认按系统 ANSI 读，UTF-8 中文会乱码。
  // 新建/空文件先写 UTF-8 BOM，方便记事本与 PowerShell 正确打开。
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size === 0) {
      fs.writeFileSync(logPath, "\uFEFF", { encoding: "utf8" });
    }
  } catch {
    // best-effort
  }
  const out = fs.openSync(logPath, "a");
  const err = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, err],
    // stdout/stderr 重定向到文件：关颜色，避免日志里残留 [22m/[39m；
    // picocolors 在 win32 上默认开色，即便不是 TTY。
    env: buildCliChildEnv({
      NUWACLI_SERVE_DAEMONIZED: "1",
      NO_COLOR: "1",
    }),
    windowsHide: true,
  });
  if (!child.pid) throw new Error(t("serve.daemonNoPid"));
  child.unref();
  debugLog("serve.daemon", "launched", {
    pid: child.pid,
    logPath,
    args,
  });
  console.log(pc.green(t("serve.daemonStarted", { pid: child.pid })));
  console.log(pc.dim(t("serve.daemonLog", { path: logPath })));
  return child.pid;
}

export async function serveCommand(
  options: ServeCommandOptions,
): Promise<void> {
  debugLog("serve.command", "start", {
    engine: options.engine,
    tunnel: options.tunnel === true,
    daemon: options.daemon === true,
    requestedPort: options.port,
    requestedHost: options.host,
    requestedCwd: options.cwd,
  });
  const isDaemonChild = process.env.NUWACLI_SERVE_DAEMONIZED === "1";
  // daemon 子进程：先等父进程把 serve.guard 转交给自己，再抢单例。
  // 否则会在 transfer 完成前看到父 PID，无 --force 时秒退（Windows 上尤甚）。
  if (isDaemonChild) {
    await waitForDaemonGuardHandoff();
  }
  try {
    const replaced = await acquireServeSingleton(options.force === true);
    if (replaced.length > 0) {
      console.log(
        pc.yellow(t("serve.forceStopped", { pids: replaced.join(", ") })),
      );
    }
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  if (options.daemon && !isDaemonChild) {
    try {
      // 先 spawn 拿到 childPid，立刻 transfer，尽量缩短子进程看到父 guard 的窗口；
      // 子进程侧另有 waitForDaemonGuardHandoff 兜底。
      const childPid = launchDaemon(options.daemonArgs);
      transferServeSingleton(process.pid, childPid);
      registerProcess({
        pid: childPid,
        kind: "serve",
        state: "starting",
        daemon: true,
        cwd: path.resolve(options.cwd ?? workspacesDir()),
        engine: options.engine,
        host: options.host ?? "127.0.0.1",
        port: options.port ? Number(options.port) : CLI_AGENT_PORT,
        logPath: serveLogPath(),
      });
    } catch (err) {
      releaseServeSingleton();
      console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
      process.exitCode = 1;
    }
    return;
  }

  registerProcess({
    pid: process.pid,
    kind: "serve",
    state: "starting",
    daemon: isDaemonChild,
    cwd: path.resolve(options.cwd ?? workspacesDir()),
    engine: options.engine,
    host: options.host ?? "127.0.0.1",
    port: options.port ? Number(options.port) : CLI_AGENT_PORT,
    logPath: isDaemonChild ? serveLogPath() : undefined,
  });

  try {
    await runServeCommand(options);
  } finally {
    releaseServeSingleton();
  }
}

async function runServeCommand(options: ServeCommandOptions): Promise<void> {
  const engineId = options.engine as EngineKind;
  try {
    getEngine(engineId);
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const cwd = path.resolve(options.cwd ?? workspacesDir());
  const cwdIsProject = Boolean(options.cwd);
  ensureDir(cwd);
  const host = options.host ?? "127.0.0.1";
  debugLog("serve.command", "workspace resolved", { cwd, cwdIsProject });
  let port: number;
  try {
    const preferredPort = parsePortOption(
      options.port,
      CLI_AGENT_PORT,
      "--port",
    );
    port = await resolveAvailablePort(preferredPort, host, "HTTP API");
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }
  // Validate explicitly so a typo (e.g. `--approve deni`, `--approve strict`)
  // errors out instead of silently falling through to yolo (full auto-approve).
  const approveParsed = parseApproveFlag(options.approve);
  if (!approveParsed.ok) {
    console.error(pc.red(`[nuwa-cli] ${approveParsed.message}`));
    process.exitCode = 1;
    return;
  }
  // 后台静默预热常用 MCP 的 npx 缓存（best-effort，不阻塞 HTTP 端口绑定）
  setImmediate(() => {
    warmupMcpNpxCache()
      .then((r) =>
        debugLog("serve.warmup", "result", {
          skipped: r.skipped,
          warmed: r.warmed,
        }),
      )
      .catch((err) => debugLog("serve.warmup", "failed", { error: String(err) }));
  });
  const permissionMode: PermissionMode = approveParsed.mode;
  let fileServerStarted = false;
  let activeFileServerPort: number | undefined;
  let lanproxyHandle: LanproxyHandle | undefined;
  // 必须在 tunnel 健康检查（最长约 26s）之前挂上信号处理器：
  // file-server 是 detached 子进程，若等 idle 循环再注册，Ctrl+C 会走默认退出
  // 且跳过 stopFileServer，留下占端口的游离进程。
  let shuttingDown = false;
  let resolveIdle: (() => void) | undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  // shutdown 时 abort，打断健康检查轮询，避免 Ctrl+C 后仍卡满 10s/15s。
  const shutdownAbort = new AbortController();
  const shutdownSignal = shutdownAbort.signal;
  const credentials = options.tunnel ? readCredentials() : {};
  const acceptedSecrets = options.tunnel
    ? [
        ...new Set(
          [credentials.configKey, credentials.savedKey].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ]
    : [];
  const overlay =
    options.apiKey || options.baseUrl || options.model
      ? {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
        }
      : undefined;

  const httpHandle = startServeHttp({
    port,
    host,
    engine: engineId,
    cwd,
    cwdIsProject,
    permissionMode,
    overlay,
    acceptedSecrets,
    allowUnauthenticatedComputerRoutes: options.tunnel === true,
  });
  const { secret, stop, addAcceptedSecret } = httpHandle;
  const onSigInt = () => shutdown("SIGINT");
  const onSigTerm = () => shutdown("SIGTERM");
  const shutdown = async (signal?: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    // 先 abort 健康检查，再停子进程，缩短 Ctrl+C 到进程退出的等待。
    if (!shutdownAbort.signal.aborted) shutdownAbort.abort();
    printShuttingDown(signal);
    debugLog("serve.command", "shutdown start", {
      fileServerStarted,
      activeFileServerPort,
      lanproxyPid: lanproxyHandle?.pid,
      signal,
    });
    await stop();
    lanproxyHandle?.stop();
    if (lanproxyHandle) debugLog("serve.lanproxy", "stopped");
    if (fileServerStarted && activeFileServerPort !== undefined) {
      stopFileServer(activeFileServerPort, cwd);
      debugLog("serve.fileServer", "stopped", {
        port: activeFileServerPort,
      });
    }
    debugLog("serve.command", "shutdown done");
    resolveIdle?.();
  };
  const markRunning = () => {
    updateProcessRecord(process.pid, {
      state: "running",
      host,
      port,
    });
  };
  if (httpHandle.server?.listening) markRunning();
  else if (httpHandle.server) httpHandle.server.once("listening", markRunning);
  else markRunning();
  debugLog("serve.command", "http started", {
    host,
    port,
    engine: engineId,
    acceptedSecrets: acceptedSecrets.length,
  });
  console.log(pc.green(t("serve.started", { host, port })));
  console.log(pc.dim(`X-Nuwax-Internal-Secret: ${secret}`));
  console.log(
    pc.dim(options.tunnel ? t("serve.secretNoteTunnel") : t("serve.secretNoteLocal")),
  );

  // keepAlive 心跳：定时刷新进程记录，减少被宿主系统判为 idle 而回收的概率。
  // （无法防系统休眠/登出等强制信号；那种场景需要 launchd KeepAlive 托管。）
  const keepAliveTimer = setInterval(() => {
    try {
      updateProcessRecord(process.pid, { state: "running" });
    } catch {
      // best-effort
    }
  }, 30_000);
  keepAliveTimer.unref();

  // HTTP 已起来就注册：覆盖后续 register / 健康检查等待窗口。
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);
  process.on("exit", () => {
    if (shuttingDown) return;
    try {
      if (fileServerStarted && activeFileServerPort !== undefined) {
        stopFileServer(activeFileServerPort, cwd);
      }
    } catch {
      // Synchronous best-effort cleanup on Windows console-close / crash.
    }
    try {
      lanproxyHandle?.stop();
    } catch {
      // Best-effort.
    }
  });

  if (permissionMode === "yolo") {
    // yolo has no path confinement (unlike the Electron client's strict gate):
    // ordinary tool calls are auto-approved, but sensitive classifiers
    // (e.g. local session history) still force ask via SSE/notify-resolved.
    console.error(pc.yellow(t("serve.yolo.header")));
    console.error(pc.yellow(t("serve.yolo.scope")));
    console.error(pc.yellow(t("serve.yolo.sensitive")));
    console.error(pc.yellow(t("serve.yolo.safety")));
    console.error(pc.dim(t("serve.yolo.alt")));
  } else if (permissionMode === "ask") {
    console.error(pc.yellow(t("serve.askMode")));
  }

  if (options.tunnel) {
    // Checks configKey (current session), not just savedKey — a device that
    // merely *remembers* a key after logout shouldn't silently reconnect;
    // the user must explicitly `nuwa-cli login` first, same as the Electron
    // client's auto-reconnect only firing when the prior session wasn't
    // explicitly logged out.
    if (
      !credentials.domain ||
      !credentials.configKey ||
      !credentials.savedKey
    ) {
      console.error(pc.yellow(t("serve.tunnelLoginRequired")));
    } else {
      try {
        // 在闭包（spinner 回调）内 TS 会丢失对 credentials.domain 的窄化，先取出。
        const domain = credentials.domain;
        const ssl = parseBooleanFlag(options.lanproxySsl, true);
        debugLog("serve.tunnel", "register start", {
          domain: credentials.domain,
          username: credentials.username,
          preferredAgentPort: port,
        });
        const fileServerPort = await resolveAvailablePort(
          CLI_FILE_SERVER_PORT,
          "127.0.0.1",
          "file-server",
          [port],
        );
        const reg = await withSpinner(
          t("serve.spinner.register"),
          () =>
            registerClient(domain, {
              username: credentials.username ?? "",
              password: "",
              savedKey: credentials.savedKey,
              deviceId: getDeviceId(),
              sandboxConfigValue: defaultSandboxValue({
                agentPort: port,
                fileServerPort,
                apiKey: secret,
              }),
            }),
          { signal: shutdownSignal },
        );
        debugLog("serve.tunnel", "register success", {
          domain: credentials.domain,
          username: credentials.username,
          computerName: reg.name,
          serverHost: reg.serverHost,
          serverPort: reg.serverPort,
          agentPort: port,
          fileServerPort,
        });
        if (
          reg.configValue?.fileServerPort &&
          reg.configValue.fileServerPort !== fileServerPort
        ) {
          console.error(
            pc.yellow(
              t("serve.fileServerPortMismatch", {
                backend: reg.configValue.fileServerPort,
                cli: fileServerPort,
              }),
            ),
          );
        }
        const lanproxyHost =
          options.lanproxyHost ?? reg.serverHost ?? credentials.serverHost;
        const lanproxyPort = parsePortOption(
          options.lanproxyPort ??
            (reg.serverPort ?? credentials.serverPort)?.toString(),
          0,
          "--lanproxy-port",
        );
        const lastRegAt = new Date().toISOString();
        addAcceptedSecret(reg.configKey);
        const serverHost = reg.serverHost ?? credentials.serverHost;
        const serverPort = reg.serverPort ?? credentials.serverPort;
        const patch: Parameters<typeof updateCredentials>[0] = {
          configKey: reg.configKey,
          savedKey: reg.configKey,
          serverHost,
          serverPort,
          token: reg.token,
          lastRegAt,
        };
        if (credentials.domain && credentials.username) {
          const remembered = rememberAccountCredentials({
            domain: credentials.domain,
            username: credentials.username,
            computerName: credentials.computerName,
            savedKey: reg.configKey,
            serverHost,
            serverPort,
            lastRegAt,
          });
          patch.savedKeys = remembered.savedKeys;
          patch.accounts = remembered.accounts;
        }
        updateCredentials(patch);
        if (
          !lanproxyHost ||
          !Number.isFinite(lanproxyPort) ||
          lanproxyPort <= 0
        ) {
          throw new Error(t("serve.lanproxyMissing"));
        }

        // register / 解析端口期间若已 Ctrl+C，禁止再 spawn detached file-server。
        if (shuttingDown) {
          // shutdown 已跑完；跳过隧道拉起。
        } else {
          // 用标签块在 await 后快速退出，避免 Ctrl+C 清理后继续拉起 lanproxy。
          bringUpTunnel: {
            if (shuttingDown) break bringUpTunnel;

            const fileServerHealthy = await withSpinner(
              t("serve.spinner.fileServer"),
              async () => {
                startFileServer(fileServerPort, cwd);
                // 立刻标记：健康检查等待中若收到 SIGINT，shutdown 才能 stopFileServer。
                fileServerStarted = true;
                activeFileServerPort = fileServerPort;
                return waitForFileServerHealth(
                  fileServerPort,
                  10_000,
                  200,
                  shutdownSignal,
                );
              },
              { signal: shutdownSignal },
            );
            if (shuttingDown) break bringUpTunnel;

            debugLog("serve.fileServer", "started", {
              port: fileServerPort,
              workspaceRoot: cwd,
              healthy: fileServerHealthy,
            });
            if (fileServerHealthy) {
              console.log(
                pc.green(t("serve.fileServer.started", { port: fileServerPort })),
              );
            } else {
              console.error(
                pc.yellow(
                  t("serve.fileServer.unhealthy", { port: fileServerPort }),
                ),
              );
            }

            const lanproxyHealthy = await withSpinner(
              t("serve.spinner.lanproxy"),
              async () => {
                lanproxyHandle = startLanproxy({
                  pathOverride:
                    options.lanproxyPath ?? credentials.lanproxyPath ?? undefined,
                  serverHost: lanproxyHost,
                  serverPort: lanproxyPort,
                  clientKey: reg.configKey,
                  ssl,
                });
                await lanproxyHandle.ready;
                const lanproxyAlive = await confirmLanproxyHealthy(
                  lanproxyHandle.pid,
                  1000,
                  shutdownSignal,
                );
                return lanproxyAlive
                  ? waitForLanproxyTunnel(
                      domain,
                      reg.configKey,
                      15_000,
                      500,
                      shutdownSignal,
                    )
                  : false;
              },
              { signal: shutdownSignal },
            );
            if (shuttingDown) break bringUpTunnel;

            debugLog("serve.lanproxy", "started", {
              pid: lanproxyHandle?.pid,
              serverHost: lanproxyHost,
              serverPort: lanproxyPort,
              ssl,
              healthy: lanproxyHealthy,
            });
            if (lanproxyHealthy) {
              console.log(
                pc.green(
                  t("serve.lanproxy.started", {
                    pid: lanproxyHandle?.pid ?? "unknown",
                    host: lanproxyHost,
                    port: lanproxyPort,
                    ssl: String(ssl),
                  }),
                ),
              );
            } else {
              console.error(
                pc.yellow(
                  t("serve.lanproxy.unhealthy", {
                    pid: lanproxyHandle?.pid ?? "unknown",
                    log: serveLogPath(),
                  }),
                ),
              );
            }
          }
        }
      } catch (err) {
        // shutdown 期间 stop() 可能导致 ready reject，勿再刷注册失败红字。
        if (!shuttingDown) {
          const message =
            err instanceof RegError ? err.message : (err as Error).message;
          debugLog("serve.tunnel", "failed", { message });
          console.error(
            pc.red(t("serve.tunnel.registerFailed", { msg: message })),
          );
        }
      }
    }
  }

  // 信号已在 HTTP 启动后注册；此处只阻塞到 shutdown resolve。
  await idle;
}
