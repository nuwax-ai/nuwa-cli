import pc from "picocolors";
import {
  listStoredAccounts,
  readCredentials,
  updateCredentials,
} from "../core/auth/credentials.js";
import { normalizeServerHost } from "../core/auth/regClient.js";
import { t } from "../util/i18n/index.js";

const SETTABLE_KEYS = [
  "domain",
  "saved-key",
  "username",
  "lanproxy-path",
] as const;
type SettableKey = (typeof SETTABLE_KEYS)[number];

function isSettableKey(key: string): key is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(key);
}

export async function configGetCommand(key?: string): Promise<void> {
  const credentials = readCredentials();
  const unset = t("config.stateUnset");
  if (!key) {
    console.log(
      t("config.domain", { value: credentials.domain ?? unset }),
    );
    console.log(
      t("config.username", { value: credentials.username ?? unset }),
    );
    console.log(
      t("config.computerName", { value: credentials.computerName ?? unset }),
    );
    console.log(
      t("config.accounts", { n: listStoredAccounts(credentials).length }),
    );
    console.log(
      t("config.savedKey", {
        state: credentials.savedKey ? t("config.stateSet") : unset,
      }),
    );
    console.log(
      t("config.lanproxyPath", {
        value: credentials.lanproxyPath ?? unset,
      }),
    );
    return;
  }
  if (!isSettableKey(key)) {
    console.error(
      pc.red(
        t("config.unknownKey", {
          key,
          keys: SETTABLE_KEYS.join(", "),
        }),
      ),
    );
    process.exitCode = 1;
    return;
  }
  if (key === "saved-key") {
    console.log(credentials.savedKey ? t("config.stateSet") : unset);
    return;
  }
  if (key === "lanproxy-path") {
    console.log(credentials.lanproxyPath ?? unset);
    return;
  }
  console.log(
    credentials[key === "domain" ? "domain" : "username"] ?? unset,
  );
}

export async function configSetCommand(
  key: string,
  value: string,
): Promise<void> {
  if (!isSettableKey(key)) {
    console.error(
      pc.red(
        t("config.unknownKey", {
          key,
          keys: SETTABLE_KEYS.join(", "),
        }),
      ),
    );
    process.exitCode = 1;
    return;
  }
  if (key === "domain") {
    updateCredentials({ domain: normalizeServerHost(value) });
  } else if (key === "saved-key") {
    updateCredentials({ savedKey: value });
  } else if (key === "lanproxy-path") {
    updateCredentials({ lanproxyPath: value });
  } else {
    updateCredentials({ username: value });
  }
  console.log(pc.green(t("config.updated", { key })));
}
