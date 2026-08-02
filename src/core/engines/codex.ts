import { resolveCodexAcp } from "@nuwax-ai/agent-kit";
import type { EngineSpec, ResolvedEngine } from "./types.js";
import { codexLogDir } from "../../util/paths.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // codex 引擎定位（require.resolve @nuwax-ai/nuwax-codex-acp-ts 的入口）已抽进
    // @nuwax-ai/agent-kit，与 nuwaclaw 共用同一策略；这里只叠加宿主特有的日志目录。
    const { command, args } = resolveCodexAcp();
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
      command,
      args,
      envOverlay,
    };
  },
};
