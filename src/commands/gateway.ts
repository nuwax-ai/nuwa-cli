import pc from "picocolors";
import {
  getSavedKeyForAccount,
  readCredentials,
} from "../core/auth/credentials.js";
import { selectEngine } from "../core/engines/probe.js";
import type { EngineKind } from "../core/env/inheritEnv.js";
import { performReg, resolveDomain, resolveLoginPassword } from "./login.js";
import { serveCommand, type ServeCommandOptions } from "./serve.js";
import { debugLog } from "../core/debugLog.js";
import {
  CANCEL_EXIT_CODE,
  UserCancelled,
  isUserCancelled,
  printCancelled,
} from "../util/ui.js";
import { t } from "../util/i18n/index.js";

export interface GatewayCommandOptions {
  domain?: string;
  savedKey?: string;
  username?: string;
  engine?: string;
  port?: string;
  host?: string;
  cwd?: string;
  approve?: string;
  lanproxyPath?: string;
  lanproxyHost?: string;
  lanproxyPort?: string;
  lanproxySsl?: string;
  daemon?: boolean;
  force?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Internal: start already completed registration during its login preflight. */
  authReady?: boolean;
}

function pushFlag(args: string[], name: string, value?: string): void {
  if (value !== undefined) args.push(name, value);
}

/**
 * 构造 daemon 子进程的 serve 参数。
 *
 * 刻意不把父进程的 `--force` 传给子进程：父进程在 launchDaemon 之前已经
 * `acquireServeSingleton(force)` 清过场；子进程再带 `--force` 会在 Windows
 * 脚本快速 retry 时二次杀进程，和刚拉起的自身/兄弟实例叠加重启竞态
 * （日志里常见：lanproxy 已启动 → 紧接着「检测到已有 serve」→ 再 force 杀掉）。
 */
export function buildServeDaemonArgs(
  options: GatewayCommandOptions,
  engine: EngineKind,
): string[] {
  const args = [process.argv[1], "serve", "--tunnel", "--engine", engine];
  pushFlag(args, "--port", options.port);
  pushFlag(args, "--host", options.host);
  pushFlag(args, "--cwd", options.cwd);
  pushFlag(args, "--approve", options.approve);
  pushFlag(args, "--lanproxy-path", options.lanproxyPath);
  pushFlag(args, "--lanproxy-host", options.lanproxyHost);
  pushFlag(args, "--lanproxy-port", options.lanproxyPort);
  pushFlag(args, "--lanproxy-ssl", options.lanproxySsl);
  pushFlag(args, "--api-key", options.apiKey);
  pushFlag(args, "--base-url", options.baseUrl);
  pushFlag(args, "--model", options.model);
  return args;
}

async function ensureRegistered(options: GatewayCommandOptions): Promise<void> {
  if (options.savedKey) {
    const domain = await resolveDomain(options.domain);
    if (!domain) throw new UserCancelled();
    const existing = readCredentials();
    await performReg(domain, {
      username: options.username ?? existing.username ?? "",
      password: "",
      savedKey: options.savedKey,
    });
    return;
  }

  if (options.username) {
    const domain = await resolveDomain(options.domain);
    if (!domain) throw new UserCancelled();
    const password = await resolveLoginPassword(options.username, domain);
    if (password === null) throw new UserCancelled();
    await performReg(domain, {
      username: options.username,
      password,
      savedKey: getSavedKeyForAccount(domain, options.username),
    });
    return;
  }

  const existing = readCredentials();
  if (existing.savedKey) {
    const domain = await resolveDomain(options.domain);
    if (!domain) throw new UserCancelled();
    await performReg(domain, {
      username: existing.username ?? "",
      password: "",
      savedKey: existing.savedKey,
    });
    return;
  }

  throw new Error(t("gateway.firstStartHint"));
}

export async function gatewayCommand(
  options: GatewayCommandOptions,
): Promise<EngineKind | undefined> {
  try {
    debugLog("gateway.command", "start", {
      domain: options.domain,
      username: options.username,
      engine: options.engine,
      hasSavedKey: Boolean(options.savedKey),
      daemon: options.daemon === true,
      cwd: options.cwd,
    });
    const { engine, probes } = await selectEngine(options.engine);
    const available = probes
      .filter((probe) => probe.ok)
      .map((probe) => probe.id)
      .join(", ");
    console.log(
      pc.green(
        available
          ? t("gateway.engineAvailable", { engine, available })
          : t("gateway.engineSelected", { engine }),
      ),
    );
    debugLog("gateway.command", "engine selected", {
      engine,
      available,
      probes: probes.map((probe) => ({
        id: probe.id,
        ok: probe.ok,
        detail: probe.ok ? undefined : probe.detail,
        fix: probe.ok ? undefined : probe.fix,
      })),
    });

    if (!options.authReady) {
      await ensureRegistered(options);
      debugLog("gateway.command", "registered");
    }

    const serveOptions: ServeCommandOptions = {
      port: options.port,
      host: options.host,
      engine,
      cwd: options.cwd,
      approve: options.approve,
      tunnel: true,
      lanproxyPath: options.lanproxyPath,
      lanproxyHost: options.lanproxyHost,
      lanproxyPort: options.lanproxyPort,
      lanproxySsl: options.lanproxySsl,
      daemon: options.daemon,
      force: options.force,
      daemonArgs: options.daemon
        ? buildServeDaemonArgs(options, engine)
        : undefined,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    };
    debugLog("gateway.command", "serve handoff", {
      engine,
      tunnel: serveOptions.tunnel,
      daemon: serveOptions.daemon,
      cwd: serveOptions.cwd,
      port: serveOptions.port,
    });
    await serveCommand(serveOptions);
    return engine;
  } catch (err) {
    if (isUserCancelled(err)) {
      // 用户主动取消(Esc / Ctrl+C),不是失败:静默提示并退出。
      printCancelled();
      process.exitCode = CANCEL_EXIT_CODE;
      return undefined;
    }
    debugLog("gateway.command", "failed", {
      message: (err as Error).message,
    });
    console.error(pc.red(t("gateway.failed", { msg: (err as Error).message })));
    process.exitCode = 1;
    return undefined;
  }
}
