import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";
import { codexLogDir } from "../../util/paths.js";

const CODEX_ACP_ENTRY = "@nuwax-ai/nuwax-codex-acp-ts/dist/index.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // @nuwax-ai/nuwax-codex-acp-ts is a package dependency (the TS ACP adapter
    // that bundles nuwax-codex, same spawn model as claude-code-acp-ts). Resolve
    // its entry via require.resolve so it works whether installed locally or
    // globally.
    const entry = resolveInstalledPackageEntry(
      "@nuwax-ai/nuwax-codex-acp-ts",
      CODEX_ACP_ENTRY,
    );
    const envOverlay: NodeJS.ProcessEnv = {};
    // The codex ACP adapter captures codex's stderr but only surfaces it as a
    // ≤2KB tail inside the failure message ("Codex process has exited …"), and
    // its built-in file logger is a no-op unless CODEX_LOG_DIR / APP_SERVER_LOGS
    // is set. Without one of these, a codex engine-start failure (e.g. sqlite
    // state init) shows only a truncated one-liner with no underlying cause, and
    // nothing flows to nuwa-cli's own `engine.stderr` capture (the adapter never
    // forwards codex stderr to its own stderr stream).
    //
    // Point it at our logs dir so the FULL codex stderr/stdout/exit lands in
    // codex/app-server.log. Respect an explicit user override — they may set
    // CODEX_LOG_DIR themselves to redirect or (with APP_SERVER_LOGS) to disable.
    if (!process.env.CODEX_LOG_DIR && !process.env.APP_SERVER_LOGS) {
      envOverlay.CODEX_LOG_DIR = codexLogDir();
    }
    return {
      command: process.execPath,
      args: [entry],
      envOverlay,
    };
  },
};
