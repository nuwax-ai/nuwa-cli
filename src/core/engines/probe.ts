import { getEngine } from "./registry.js";
import type { EngineKind } from "../env/inheritEnv.js";

export interface EngineProbeResult {
  id: EngineKind;
  ok: boolean;
  detail: string;
  fix?: string;
}

const ENGINE_IDS: EngineKind[] = ["claude", "codex"];

function fixForEngine(id: EngineKind): string {
  return id === "claude"
    ? "reinstall nuwa-cli and ensure the claude-agent-sdk platform package is installed"
    : "reinstall nuwa-cli and ensure @nuwax-ai/nuwax-codex-acp-ts is installed";
}

export async function probeEngine(id: EngineKind): Promise<EngineProbeResult> {
  try {
    const resolved = await getEngine(id).resolve();
    return {
      id,
      ok: true,
      detail: `${resolved.command} ${resolved.args.join(" ")}`.trim(),
    };
  } catch (err) {
    return {
      id,
      ok: false,
      detail: (err as Error).message,
      fix: fixForEngine(id),
    };
  }
}

export async function probeAvailableEngines(): Promise<EngineProbeResult[]> {
  return Promise.all(ENGINE_IDS.map((id) => probeEngine(id)));
}

export async function selectEngine(
  explicit?: string,
  random: () => number = Math.random,
): Promise<{ engine: EngineKind; probes: EngineProbeResult[] }> {
  const probes = await probeAvailableEngines();

  if (explicit) {
    if (explicit !== "claude" && explicit !== "codex") {
      throw new Error(`unknown engine "${explicit}", available: claude, codex`);
    }
    const selected = probes.find((probe) => probe.id === explicit);
    if (!selected?.ok) {
      throw new Error(
        `${explicit} unavailable: ${selected?.detail ?? "unknown error"}${
          selected?.fix ? `. ${selected.fix}` : ""
        }`,
      );
    }
    return { engine: explicit, probes };
  }

  const available = probes.filter((probe) => probe.ok);
  if (available.length === 0) {
    const details = probes
      .map(
        (probe) =>
          `- ${probe.id}: ${probe.detail}${probe.fix ? `; ${probe.fix}` : ""}`,
      )
      .join("\n");
    throw new Error(
      `no available agent engine. Ensure the Claude/Codex ACP platform package for the current platform is installed.\n${details}`,
    );
  }

  if (available.length === 1) {
    return { engine: available[0].id, probes };
  }

  const index = Math.floor(random() * available.length) % available.length;
  return { engine: available[index].id, probes };
}
