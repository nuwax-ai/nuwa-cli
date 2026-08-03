import { resolvePackageEntry } from "@nuwax-ai/agent-kit";

export function resolveInstalledPackageEntry(
  packageName: string,
  entrySpecifier: string,
): string {
  return resolvePackageEntry(packageName, entrySpecifier);
}
