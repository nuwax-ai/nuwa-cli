export interface ResolvedEngine {
  command: string;
  args: string[];
  /** Env values this engine needs beyond the inherited base (e.g. CLAUDE_CODE_EXECUTABLE). */
  envOverlay: NodeJS.ProcessEnv;
}

export interface EngineSpec {
  id: "claude" | "codex";
  /** Resolves the packaged or system engine spawn target. Local account/config files are optional when ACP supplies runtime configuration. */
  resolve(): Promise<ResolvedEngine>;
}
