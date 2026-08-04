import type { EngineSpec } from "./types.js";
import { claudeEngine } from "./claude.js";
import { codexEngine } from "./codex.js";

/**
 * Registered engines. Adding a future custom engine is just another entry
 * here — nothing else about the ACP connection layer changes.
 */
const registry: Record<string, EngineSpec> = {
  claude: claudeEngine,
  codex: codexEngine,
};

export function getEngine(id: string): EngineSpec {
  const engine = registry[id];
  if (!engine) {
    const known = Object.keys(registry).join(", ");
    throw new Error(`unknown engine "${id}", available: ${known}`);
  }
  return engine;
}
