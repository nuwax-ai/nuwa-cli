import pc from "picocolors";
import { gatewayCommand } from "./gateway.js";
import { uiCommand } from "./ui.js";
import {
  findServeProcessIds,
  stopMcpProxyProcesses,
  stopTunnelChildProcesses,
} from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { stopProcessIds } from "../core/processes/processRegistry.js";
import { waitForGatewayStackReady } from "../core/processes/lanproxyStatus.js";
import { debugLog } from "../core/debugLog.js";

export interface RestartCommandOptions {
  all?: boolean;
  engine?: string;
  open?: boolean;
}

/**
 * 停止所有正在运行的 serve(Gateway) + console + tunnel 子服务，给一个干净起点。
 * file-server 为 detached，不能依赖「杀 serve 进程树」自动带走，必须显式清理。
 *
 * 供 restart / doctor --fix / 登录后切换系统服务等场景复用，避免各自只停 gateway
 * 而留下 detached 子进程占端口（表现为「只重启了 gateway」）。
 */
export async function stopAllNuwaProcesses(): Promise<number> {
  const servePids = findServeProcessIds(0); // 0 = 不排除自身，全部清理
  const uiPids = findUiProcessIds();
  const allPids = [...servePids, ...uiPids].filter((pid) => pid !== process.pid);
  debugLog("restart", "stopping existing processes", { pids: allPids });
  if (allPids.length > 0) {
    await stopProcessIds(allPids);
  }
  // 即便没有 serve/console，也可能残留 detached file-server / lanproxy / mcp-proxy。
  const tunnelPids = await stopTunnelChildProcesses();
  await stopMcpProxyProcesses();
  const stopped = allPids.length + tunnelPids.length;
  // 给 OS 一点时间释放端口；测试环境跳过以免拖慢单测。
  if (stopped > 0 && !process.env.VITEST) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return stopped;
}

/**
 * 强制重启完整 serve 栈：先 stopAllNuwaProcesses 清掉所有旧进程，再以 daemon 方式
 * 强制拉起 Gateway（由其重新派生 file-server / lanproxy 等全部子服务）。
 * restart 命令、doctor --fix、安装后重启等「修复/升级后重启」场景共用此逻辑。
 */
export async function restartAllServicesForced(
  options: { engine?: string } = {},
): Promise<void> {
  // 未登录则跳过——serve/gateway 需要 Nuwax 凭证才能注册连 Gateway。统一提示先登录，
  // 覆盖 restart / doctor --fix / 升级后重启等所有走本函数的场景；不在此时走
  // ensureRegistered 的「需要 --domain」报错（那条对自动重启场景不贴切）。
  const { readCredentials } = await import("../core/auth/credentials.js");
  if (!readCredentials().configKey) {
    console.log(
      pc.yellow(
        "未登录 Nuwax，已跳过服务重启。请先运行 `nuwa-cli login` 登录，再运行 `nuwa-cli gateway` 启动服务。",
      ),
    );
    return;
  }
  console.log(pc.dim("正在清理所有已运行的 Gateway / Console 进程..."));
  const stopped = await stopAllNuwaProcesses();
  if (stopped > 0) {
    console.log(pc.green(`已停止 ${stopped} 个旧进程。`));
  } else {
    console.log(pc.dim("没有需要清理的旧进程。"));
  }

  console.log(pc.dim("正在强制重启 Gateway Server..."));
  await gatewayCommand({
    engine: options.engine,
    daemon: true,
    force: true,
  });
}

/**
 * 打印 daemon handoff 后的 Gateway + lanproxy 就绪结果（与 start 共用等待逻辑）。
 */
async function reportGatewayStackReadiness(): Promise<void> {
  const ready = await waitForGatewayStackReady();
  if (ready.lanproxy && ready.gateway.state === "running") {
    console.log(
      pc.green(
        `lanproxy 运行中（PID ${ready.lanproxy.pid}，${ready.lanproxy.host ?? "未知主机"}:${ready.lanproxy.port ?? "未知端口"}），Gateway /health 正常。`,
      ),
    );
    return;
  }
  if (ready.lanproxy) {
    console.error(
      pc.yellow(
        `[nuwa-cli] lanproxy 进程存在（PID ${ready.lanproxy.pid}），但 Gateway /health 不可用；请查看 ~/.nuwa-cli/logs/serve.YYYY-MM-DD.log。`,
      ),
    );
    return;
  }
  console.error(
    pc.yellow(
      "[nuwa-cli] 未检测到运行中的 lanproxy；请查看 ~/.nuwa-cli/logs/serve.YYYY-MM-DD.log 或运行 `nuwa-cli doctor`。若脚本在做强制 retry，请先等本命令结束或先 `nuwa-cli status` 确认已就绪，再决定是否再次 --force。",
    ),
  );
}

export async function restartCommand(
  options: RestartCommandOptions,
): Promise<void> {
  const includeConsole = options.all === true;

  await restartAllServicesForced({ engine: options.engine });

  if (process.exitCode && process.exitCode !== 0) {
    console.error(
      pc.red("[nuwa-cli] Gateway 重启失败。"),
    );
    return;
  }

  await reportGatewayStackReadiness();

  if (!includeConsole) {
    console.log(
      pc.dim(
        "Gateway 已重启。需要同时重启 Console 时请运行 `nuwa-cli restart --all`。",
      ),
    );
    return;
  }

  console.log(pc.dim("正在强制重启前台 Console..."));
  await uiCommand({
    engine: options.engine,
    force: true,
    open: options.open,
  });
}
