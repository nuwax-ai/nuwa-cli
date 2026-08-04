import pc from "picocolors";
import {
  listStoredAccounts,
  readCredentials,
  resolveStoredAccount,
} from "../core/auth/credentials.js";
import { getServeStatus } from "../core/serve/serveLock.js";
import { performReg } from "./login.js";
import { t } from "../util/i18n/index.js";

export async function accountListCommand(): Promise<void> {
  const accounts = listStoredAccounts();
  if (accounts.length === 0) {
    console.log(pc.dim(t("account.list.empty")));
    return;
  }

  for (const item of accounts) {
    const marker = item.current ? "*" : " ";
    const computerName =
      item.account.computerName ?? t("account.list.unknownComputer");
    console.log(
      `${marker} ${item.key}  ${item.account.domain}  ${item.account.username}  ${computerName}`,
    );
  }
}

export async function accountSwitchCommand(selector: string): Promise<void> {
  try {
    const serveStatus = await getServeStatus();
    if (serveStatus.state !== "stopped") {
      console.error(
        pc.red(
          t("account.switch.running", {
            port: serveStatus.port,
            pid: serveStatus.pid,
          }),
        ),
      );
      process.exitCode = 1;
      return;
    }

    const credentials = readCredentials();
    const resolved = resolveStoredAccount(selector, credentials);
    if (!resolved) {
      console.error(
        pc.red(t("account.switch.notFound", { selector })),
      );
      process.exitCode = 1;
      return;
    }

    await performReg(resolved.account.domain, {
      username: resolved.account.username,
      password: "",
      savedKey: resolved.account.savedKey,
    });
    console.log(
      pc.green(
        t("account.switch.done", {
          username: resolved.account.username,
          domain: resolved.account.domain,
        }),
      ),
    );
  } catch (err) {
    console.error(
      pc.red(t("account.switch.failed", { msg: (err as Error).message })),
    );
    process.exitCode = 1;
  }
}
