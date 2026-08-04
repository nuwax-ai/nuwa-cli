import pc from "picocolors";
import {
  listRegisteredProcesses,
  stopProcessIds,
} from "../core/processes/processRegistry.js";
import {
  discoverLegacyNuwaProcesses,
  findServeProcessIds,
  stopServeProcesses,
  stopTunnelChildProcesses,
} from "../core/processes/serveSingleton.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import { t } from "../util/i18n/index.js";

export interface ProcessesCommandOptions {
  json?: boolean;
}

function endpoint(host?: string, port?: number): string {
  return host && port ? `http://${host}:${port}` : "-";
}

function processLabel(
  kind: "serve" | "ui" | "chat" | "lanproxy" | "file-server",
): string {
  if (kind === "serve") return t("processes.label.gateway");
  if (kind === "ui") return t("processes.label.console");
  if (kind === "lanproxy") return t("processes.label.lanproxy");
  if (kind === "chat") return t("processes.label.chat");
  return t("processes.label.fileServer");
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
    console.log(t("processes.none"));
    return;
  }

  console.log(t("processes.header"));
  for (const record of records) {
    const state =
      record.state === "running"
        ? pc.green(t("processes.state.running"))
        : pc.yellow(t("processes.state.starting"));
    const mode =
      record.daemon === null
        ? t("processes.mode.legacy")
        : record.daemon
          ? t("processes.mode.daemon")
          : t("processes.mode.foreground");
    console.log(
      `${record.pid}\t${processLabel(record.kind)}\t${state}\t${mode}\t${endpoint(record.host, record.port)}\t${record.startedAt ?? "-"}`,
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
      console.log(
        pc.green(
          t("processes.stoppedGateway", { pids: gatewayPids.join(", ") }),
        ),
      );
    }
    if (consolePids.length > 0) {
      console.log(
        pc.green(
          t("processes.stoppedConsole", { pids: consolePids.join(", ") }),
        ),
      );
    }
    if (gatewayPids.length === 0 && consolePids.length === 0) {
      console.log(t("processes.noneInRange"));
    }
  } catch (err) {
    console.error(
      pc.red(
        t("processes.stopFailed", {
          msg: (err as Error).message,
        }),
      ),
    );
    process.exitCode = 1;
  }
}
