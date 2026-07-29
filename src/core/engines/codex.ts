import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

const CODEX_ACP_ENTRY = "@nuwax-ai/nuwax-codex-acp-ts/dist/index.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // @nuwax-ai/nuwax-codex-acp-ts is a package dependency (TS ACP adapter,
    // same model as claude-code-acp-ts). resolve its entry via require.resolve
    // so it works whether installed locally or globally.
    const entry = resolveInstalledPackageEntry(
      "@nuwax-ai/nuwax-codex-acp-ts",
      CODEX_ACP_ENTRY,
    );
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: {},
    };
  },
};
