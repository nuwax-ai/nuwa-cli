import {
  listRegisteredProcesses,
  type NuwaProcessRecord,
} from "./processRegistry.js";
import {
  getServeStatus,
  type ServeStatus,
} from "../serve/serveLock.js";
import { serveLogPath } from "../../util/paths.js";

/** daemon handoff 后等待 Gateway+/lanproxy 的默认超时（覆盖 file-server ≤10s + 注册余量）。 */
export const GATEWAY_STACK_READY_TIMEOUT_MS = 30_000;

export function findLanproxyProcesses(): NuwaProcessRecord[] {
  return listRegisteredProcesses().filter(
    (record) => record.kind === "lanproxy",
  );
}

export async function waitForLanproxyProcess(
  timeoutMs = 8_000,
  intervalMs = 100,
): Promise<NuwaProcessRecord | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const record = findLanproxyProcesses()[0];
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return undefined;
}

export interface GatewayStackReadyResult {
  gateway: ServeStatus;
  lanproxy: NuwaProcessRecord | undefined;
}

/** Gateway `/health` 正常且进程注册表中有存活的 lanproxy。 */
export function isGatewayStackReady(ready: GatewayStackReadyResult): boolean {
  return ready.gateway.state === "running" && Boolean(ready.lanproxy);
}

/**
 * 等待 daemon 拉起后的完整就绪：Gateway `/health` 正常且 lanproxy 已写入进程注册表。
 *
 * `serve --daemon` 父进程在 spawn 后立刻返回，tunnel（注册 → file-server → lanproxy）
 * 仍在子进程内异步进行；原先只轮询 lanproxy 8s，强制 restart 场景下极易误报
 * 「未检测到 lanproxy」。此处合并等待，默认 30s。
 */
export async function waitForGatewayStackReady(
  timeoutMs = GATEWAY_STACK_READY_TIMEOUT_MS,
  intervalMs = 200,
): Promise<GatewayStackReadyResult> {
  const deadline = Date.now() + timeoutMs;
  let gateway = await getServeStatus();
  let lanproxy = findLanproxyProcesses()[0];
  while (Date.now() < deadline) {
    if (gateway.state === "running" && lanproxy) {
      return { gateway, lanproxy };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    gateway = await getServeStatus();
    lanproxy = findLanproxyProcesses()[0];
  }
  return { gateway, lanproxy };
}

/**
 * 打印就绪结果；未就绪时设置 `process.exitCode = 1`，供安装脚本/CI 用退出码判定假成功。
 * @returns 是否完整就绪
 */
export async function reportGatewayStackReadiness(
  opts: { timeoutMs?: number; spinnerMessage?: string } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? GATEWAY_STACK_READY_TIMEOUT_MS;
  // 延迟 import picocolors，避免本模块被纯探测路径加载时拉 UI 依赖失败。
  const pc = (await import("picocolors")).default;
  // 等待阶段用 spinner 给反馈；spinner 停止后再打印结果行，避免交错。
  let ready: GatewayStackReadyResult;
  if (opts.spinnerMessage) {
    const { withSpinner } = await import("../../util/ui.js");
    ready = await withSpinner(opts.spinnerMessage, () =>
      waitForGatewayStackReady(timeoutMs),
    );
  } else {
    ready = await waitForGatewayStackReady(timeoutMs);
  }
  if (isGatewayStackReady(ready) && ready.lanproxy) {
    console.log(
      pc.green(
        `lanproxy 运行中（PID ${ready.lanproxy.pid}，${ready.lanproxy.host ?? "未知主机"}:${ready.lanproxy.port ?? "未知端口"}），Gateway /health 正常。`,
      ),
    );
    return true;
  }
  if (ready.lanproxy) {
    console.error(
      pc.yellow(
        `[nuwa-cli] lanproxy 进程存在（PID ${ready.lanproxy.pid}），但 Gateway /health 不可用；请查看 ${serveLogPath()}。`,
      ),
    );
  } else {
    console.error(
      pc.yellow(
        `[nuwa-cli] 未检测到运行中的 lanproxy；请查看 ${serveLogPath()} 或运行 \`nuwa-cli doctor\`。升级/安装脚本请勿仅凭 spawn 成功判定；可手动 \`nuwa-cli start\` 或 \`nuwa-cli restart\`。`,
      ),
    );
  }
  process.exitCode = 1;
  return false;
}
