import pc from "picocolors";
import { listRegisteredProcesses } from "../core/processes/processRegistry.js";
import {
  discoverLegacyNuwaProcesses,
  findServeProcessIds,
  stopServeProcesses,
} from "../core/processes/serveSingleton.js";

export interface ProcessesCommandOptions {
  json?: boolean;
}

function endpoint(host?: string, port?: number): string {
  return host && port ? `http://${host}:${port}` : "-";
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
      `${record.pid}\t${record.kind}\t${state}\t${record.daemon === null ? "legacy" : record.daemon ? "daemon" : "foreground"}\t${endpoint(record.host, record.port)}\t${record.startedAt ?? "-"}`,
    );
  }
}

export async function stopCommand(): Promise<void> {
  const pids = findServeProcessIds();
  if (pids.length === 0) {
    console.log("未发现正在运行的 nuwa-cli serve。");
    return;
  }
  try {
    await stopServeProcesses(pids);
    console.log(pc.green(`已停止 nuwa-cli serve（PID ${pids.join(", ")}）。`));
  } catch (err) {
    console.error(
      pc.red(`[nuwa-cli] 停止 serve 失败：${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}
