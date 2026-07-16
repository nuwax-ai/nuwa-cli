import {
  listRegisteredProcesses,
  type NuwaProcessRecord,
} from "./processRegistry.js";

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
