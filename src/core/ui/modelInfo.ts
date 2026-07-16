import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { EngineKind } from "../env/inheritEnv.js";

/**
 * Best-effort "configured model" read from the engine's own local config.
 *
 * Used when no live session is available — the engine panel before a session
 * is started, or as a read-only fallback when an engine doesn't expose a
 * switchable model via ACP `configOptions`. Returns undefined when it can't be
 * determined; never throws.
 */
export function getEngineModelHint(engine: EngineKind): string | undefined {
  try {
    if (engine === "claude") {
      const file = path.join(os.homedir(), ".claude", "settings.json");
      const raw = fs.readFileSync(file, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const env = obj.env;
      const envObj =
        env && typeof env === "object" ? (env as Record<string, unknown>) : {};
      // ANTHROPIC_MODEL is the concrete model override (the model that actually
      // runs), so prefer it over the `model` tier alias ("sonnet"/"opus"/...)
      // which may itself map to a different concrete model via ANTHROPIC_DEFAULT_*.
      if (typeof envObj.ANTHROPIC_MODEL === "string" && envObj.ANTHROPIC_MODEL)
        return envObj.ANTHROPIC_MODEL;
      if (typeof obj.model === "string" && obj.model) return obj.model;
      for (const key of [
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      ]) {
        if (typeof envObj[key] === "string" && envObj[key]) return envObj[key] as string;
      }
      return undefined;
    }
    // codex: ~/.codex/config.toml `model = "..."` — regex parsed, no TOML dep.
    // Accept both double- and single-quoted TOML strings.
    const file = path.join(os.homedir(), ".codex", "config.toml");
    const raw = fs.readFileSync(file, "utf-8");
    const match = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derives the live model id from a session's ACP `configOptions`: the
 * `currentValue` of the first option whose category is `"model"` (then
 * `"model_config"`). Defensive against the config-option union shape — it
 * only relies on `category` + `currentValue`, not on a specific discriminant.
 *
 * Returns undefined when the engine didn't expose a model option, which the
 * caller treats as "show the read-only engine hint instead".
 */
export function modelFromConfigOptions(
  options: SessionConfigOption[] | null | undefined,
): string | undefined {
  if (!options || !Array.isArray(options)) return undefined;
  for (const category of ["model", "model_config"] as const) {
    const hit = options.find((option) => {
      const o = option as { category?: unknown; currentValue?: unknown };
      return o.category === category && typeof o.currentValue === "string";
    });
    const value = (hit as { currentValue?: string } | undefined)?.currentValue;
    if (value) return value;
  }
  return undefined;
}
