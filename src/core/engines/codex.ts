import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

const NUWAX_CODEX_ACP_ENTRY = "nuwax-codex-acp/bin/nuwax-codex-acp.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // nuwax-codex-acp is a package dependency; its wrapper resolves the
    // matching platform binary from optionalDependencies.
    const entry = resolveInstalledPackageEntry(
      "nuwax-codex-acp",
      NUWAX_CODEX_ACP_ENTRY,
    );
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: {},
    };
  },
};
