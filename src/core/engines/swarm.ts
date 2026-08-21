import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngineSpec, ResolvedEngine } from "./types.js";

/**
 * nuwax-swarm engine: the @nuwax-ai/swarm four-specialist orchestrator
 * (researcher / diagnostician / solver / rule-executor) exposed as one ACP agent.
 * Spawn target: node <nuwax-swarm>/packages/acp/dist/index.js (stdio ACP).
 */
const DEFAULT_SWARM_ROOT = join(homedir(), "workspace/nuwax-swarm");

export const swarmEngine: EngineSpec = {
  id: "swarm",
  async resolve(): Promise<ResolvedEngine> {
    const root = process.env.NUWAX_SWARM_ROOT ?? DEFAULT_SWARM_ROOT;
    const entry = join(root, "packages/acp/dist/index.js");
    if (!existsSync(entry)) {
      throw new Error(
        `swarm engine entry not found: ${entry} (set NUWAX_SWARM_ROOT or build nuwax-swarm)`,
      );
    }
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: {
        NUWAX_SWARM_AGENTS: join(root, "agents.yaml"),
      },
    };
  },
};
