import pc from "picocolors";
import { readCredentials } from "../core/auth/credentials.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import { printGatewayStatusLine } from "../core/serve/statusView.js";
import { findUiProcessIds } from "../core/processes/uiSingleton.js";
import {
  getServiceStatus,
  installService,
  startService,
  stopService,
  uninstallService,
  type ServiceInstallOptions,
} from "../core/service/serviceManager.js";
import { t } from "../util/i18n/index.js";

function hasUsableDefaultAccount(): boolean {
  const credentials = readCredentials();
  return Boolean(credentials.domain && credentials.savedKey);
}

function requireDefaultAccount(): void {
  if (hasUsableDefaultAccount()) return;
  throw new Error(t("service.requireAccount"));
}

function printPlatformNote(): void {
  if (process.platform === "darwin") {
    console.log(pc.dim(t("service.note.macos")));
  } else if (process.platform === "linux") {
    console.log(pc.dim(t("service.note.linux")));
  } else if (process.platform === "win32") {
    console.log(pc.dim(t("service.note.windows")));
  }
}

export async function serviceInstallCommand(
  options: ServiceInstallOptions,
): Promise<void> {
  try {
    requireDefaultAccount();
    installService(options);
    console.log(
      pc.green(
        options.now
          ? t("service.install.installedNow")
          : t("service.install.installedLater"),
      ),
    );
    printPlatformNote();
  } catch (err) {
    console.error(
      pc.red(t("service.install.failed", { msg: (err as Error).message })),
    );
    console.log(pc.dim(t("service.install.failedHint")));
    process.exitCode = 1;
  }
}

export async function serviceStartCommand(): Promise<void> {
  try {
    requireDefaultAccount();
    startService();
    console.log(pc.green(t("service.start.done")));
  } catch (err) {
    console.error(
      pc.red(t("service.start.failed", { msg: (err as Error).message })),
    );
    process.exitCode = 1;
  }
}

export async function serviceStopCommand(): Promise<void> {
  try {
    stopService();
    console.log(pc.green(t("service.stop.done")));
  } catch (err) {
    console.error(
      pc.red(t("service.stop.failed", { msg: (err as Error).message })),
    );
    process.exitCode = 1;
  }
}

export async function serviceUninstallCommand(): Promise<void> {
  try {
    uninstallService();
    console.log(pc.green(t("service.uninstall.done")));
  } catch (err) {
    console.error(
      pc.red(t("service.uninstall.failed", { msg: (err as Error).message })),
    );
    process.exitCode = 1;
  }
}

export async function serviceStatusCommand(): Promise<void> {
  try {
    const service = getServiceStatus();
    const installed = service.installed
      ? t("service.status.installedWord")
      : t("service.status.notInstalledWord");
    const active =
      service.active === null
        ? t("service.status.activeUnknown")
        : service.active
          ? t("service.status.activeRunning")
          : t("service.status.activeStopped");
    console.log(t("service.status.line", { installed, active }));
    if (service.configPath)
      console.log(pc.dim(t("service.status.configPath", { path: service.configPath })));
    if (service.taskName)
      console.log(
        pc.dim(t("service.status.taskNameLine", { name: service.taskName })),
      );
    if (service.autostartMethod)
      console.log(
        pc.dim(
          t("service.status.autostartMethodLine", {
            method:
              service.autostartMethod === "taskScheduler"
                ? t("service.method.taskScheduler")
                : t("service.method.startupFolder"),
          }),
        ),
      );

    const serve = await getServeStatus();
    printGatewayStatusLine(serve);
    const consolePids = findUiProcessIds();
    console.log(
      consolePids.length > 0
        ? t("service.status.consoleRunning", { pids: consolePids.join(", ") })
        : t("service.status.consoleIdle"),
    );

    if (service.details.trim()) {
      console.log(pc.dim(t("service.status.detailsHeader")));
      console.log(pc.dim(service.details.trim()));
    }
  } catch (err) {
    console.error(
      pc.red(t("service.status.failed", { msg: (err as Error).message })),
    );
    process.exitCode = 1;
  }
}
