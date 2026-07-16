import { findOnPath } from "../../util/which.js";
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
    return {
      command: process.execPath,
      args: [entry],
      // Prefer the user's installed CLI when present. Otherwise the adapter
      // resolves the native Claude runtime bundled by claude-agent-sdk.
      envOverlay: claudeBin ? { CLAUDE_CODE_EXECUTABLE: claudeBin } : {},
    };
  },
};
