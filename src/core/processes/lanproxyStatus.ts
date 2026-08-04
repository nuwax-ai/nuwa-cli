import {
  listRegisteredProcesses,
  type NuwaProcessRecord,
} from "./processRegistry.js";
import {
  getServeStatus,
  type ServeStatus,
} from "../serve/serveLock.js";

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
