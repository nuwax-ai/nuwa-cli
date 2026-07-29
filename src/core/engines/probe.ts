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
    ? "重新安装 nuwa-cli，并确认 claude-agent-sdk 当前平台包已安装"
    : "重新安装 nuwa-cli，并确认 @nuwax-ai/nuwax-codex-acp-ts 已安装";
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
      throw new Error(`未知引擎 "${explicit}"，可用引擎：claude, codex`);
    }
    const selected = probes.find((probe) => probe.id === explicit);
    if (!selected?.ok) {
      throw new Error(
        `${explicit} 不可用：${selected?.detail ?? "未知错误"}${
          selected?.fix ? `。${selected.fix}` : ""
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
          `- ${probe.id}: ${probe.detail}${probe.fix ? `；${probe.fix}` : ""}`,
      )
      .join("\n");
    throw new Error(
      `未找到可用 Agent 引擎。请确认 Claude/Codex ACP 的当前平台包已安装。\n${details}`,
    );
  }

  if (available.length === 1) {
    return { engine: available[0].id, probes };
  }

  const index = Math.floor(random() * available.length) % available.length;
  return { engine: available[index].id, probes };
}
