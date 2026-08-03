import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Ensure packages/agent-kit/dist exists before tests run.
 *
 * tests/agentKit.test.ts loads dist/index.cjs via require() to guard the
 * dual-format CJS build invariant — the whole point of the tsup ESM+CJS build
 * (nuwaclaw consumes the CJS artifact). On a fresh checkout, after `npm run
 * clean`, or in CI that didn't run `prepare`, dist is absent and that test would
 * fail spuriously. Build it here (only when missing) so every entry point —
 * `npm test`, `npm run test:run`, direct `vitest`, CI — is covered.
 */
export default function ensureAgentKitBuilt(): void {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const distCjs = `${repoRoot}packages/agent-kit/dist/index.cjs`;
  if (existsSync(distCjs)) return;

  const result = spawnSync(
    "npm",
    ["run", "build", "-w", "@nuwax-ai/agent-kit"],
    { stdio: "inherit", cwd: repoRoot },
  );
  if (result.status !== 0) {
    throw new Error(
      "globalSetup: @nuwax-ai/agent-kit build failed — cannot run CJS invariant test.",
    );
  }
}
