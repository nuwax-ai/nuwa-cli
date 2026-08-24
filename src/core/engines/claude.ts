import { findOnPath, isDirectlySpawnable } from "../../util/which.js";
import { resolveClaudeAcp } from "@nuwax-ai/agent-kit";
import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

const CLAUDE_CODE_ACP_ENTRY = "claude-code-acp-ts/dist/index.js";

export const claudeEngine: EngineSpec = {
  id: "claude",
  async resolve(): Promise<ResolvedEngine> {
    const claudeBin = findOnPath("claude");
    const entry = resolveInstalledPackageEntry(
      "claude-code-acp-ts",
      CLAUDE_CODE_ACP_ENTRY,
    );
    const { command, args } = resolveClaudeAcp({ entryOverride: entry });
    return {
      command,
      args,
      // Prefer the user's installed CLI when present. Otherwise the adapter
      // resolves the native Claude runtime bundled by claude-agent-sdk.
      // The CLI must be directly spawnable, though: on Windows `which` usually
      // finds the npm shim (claude.CMD), and the adapter spawns
      // CLAUDE_CODE_EXECUTABLE without a shell — a shim here kills session/new
      // with spawn EINVAL (surfaces as ACP "Internal error" → engine start
      // failed). Non-spawnable paths fall back to the bundled runtime.
      envOverlay:
        claudeBin && isDirectlySpawnable(claudeBin)
          ? { CLAUDE_CODE_EXECUTABLE: claudeBin }
          : {},
    };
  },
};
