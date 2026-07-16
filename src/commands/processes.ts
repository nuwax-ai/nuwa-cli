import pc from "picocolors";
import {
  listRegisteredProcesses,
  stopProcessIds,
} from "../core/processes/processRegistry.js";
import {
  discoverLegacyNuwaProcesses,
  findServeProcessIds,
  stopServeProcesses,
} from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";

export interface ProcessesCommandOptions {
  json?: boolean;
}

function endpoint(host?: string, port?: number): string {
  return host && port ? `http://${host}:${port}` : "-";
}

function processLabel(kind: "serve" | "ui" | "chat" | "lanproxy"): string {
  if (kind === "serve") return "gateway";
  if (kind === "ui") return "console";
  if (kind === "lanproxy") return "lanproxy";
  return kind;
}

export function processesCommand(options: ProcessesCommandOptions): void {
  const registered = listRegisteredProcesses();
  const registeredPids = new Set(registered.map((record) => record.pid));
  const legacy = discoverLegacyNuwaProcesses()
    .filter((record) => !registeredPids.has(record.pid))
    .map((record) => ({
      ...record,
      state: "running" as const,
      daemon: null,
      host: undefined,
      port: undefined,
      startedAt: undefined,
      registered: false as const,
    }));
  const records = [
    ...registered.map((record) => ({ ...record, registered: true as const })),
    ...legacy,
  ].sort((a, b) => a.pid - b.pid);
  if (options.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log("未发现仍在运行的 nuwa-cli 进程。");
    return;
  }

  console.log("PID\t类型\t状态\t模式\t地址\t启动时间");
  for (const record of records) {
    const state =
      record.state === "running"
        ? pc.green("running")
        : pc.yellow("starting");
    console.log(
      `${record.pid}\t${processLabel(record.kind)}\t${state}\t${record.daemon === null ? "legacy" : record.daemon ? "daemon" : "foreground"}\t${endpoint(record.host, record.port)}\t${record.startedAt ?? "-"}`,
    );
  }
}

export interface StopCommandOptions {
  all?: boolean;
  gateway?: boolean;
  console?: boolean;
}

export async function stopCommand(
  options: StopCommandOptions = {},
): Promise<void> {
  const stopGateway = options.all || options.gateway || !options.console;
  const stopConsole = options.all || options.console;
  const gatewayPids = stopGateway ? findServeProcessIds() : [];
  const consolePids = stopConsole ? findUiProcessIds() : [];
  try {
    if (stopGateway) await stopServeProcesses(gatewayPids);
    if (stopConsole) await stopProcessIds(consolePids);
    if (gatewayPids.length > 0) {
      console.log(pc.green(`已停止 Gateway（PID ${gatewayPids.join(", ")}）。`));
    }
    if (consolePids.length > 0) {
      console.log(pc.green(`已停止 Console（PID ${consolePids.join(", ")}）。`));
    }
    if (gatewayPids.length === 0 && consolePids.length === 0) {
      console.log("未发现选定范围内正在运行的服务。");
    }
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 停止服务失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}
