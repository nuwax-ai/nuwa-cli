import { describe, expect, it } from "vitest";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { modelFromConfigOptions } from "../src/core/ui/modelInfo.js";

function opt(o: object): SessionConfigOption[] {
  return [o] as unknown as SessionConfigOption[];
}

describe("modelFromConfigOptions", () => {
  it("returns the currentValue of the model-category select option", () => {
    expect(
      modelFromConfigOptions(
        opt({
          type: "select",
          id: "model",
          category: "model",
          currentValue: "opus",
          options: [{ value: "opus", name: "Opus" }],
        }),
      ),
    ).toBe("opus");
  });

  it("falls back to model_config when no model category is present", () => {
    expect(
      modelFromConfigOptions(
        opt({
          type: "select",
          id: "model_config",
          category: "model_config",
          currentValue: "gpt-5.6",
          options: [],
        }),
      ),
    ).toBe("gpt-5.6");
  });

  it("prefers model over model_config when both exist", () => {
    expect(
      modelFromConfigOptions([
        {
          type: "select",
          id: "effort",
          category: "thought_level",
          currentValue: "default",
          options: [],
        },
        {
          type: "select",
          id: "model_config",
          category: "model_config",
          currentValue: "fallback",
          options: [],
        },
        {
          type: "select",
          id: "model",
          category: "model",
          currentValue: "sonnet",
          options: [],
        },
      ] as unknown as SessionConfigOption[]),
    ).toBe("sonnet");
  });

  it("ignores boolean options (no string currentValue) and unrelated categories", () => {
    expect(
      modelFromConfigOptions(
        opt({ type: "boolean", id: "stream", category: "model", currentValue: true }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when no model option is exposed (the degraded path)", () => {
    expect(modelFromConfigOptions(null)).toBeUndefined();
    expect(modelFromConfigOptions(undefined)).toBeUndefined();
    expect(modelFromConfigOptions([])).toBeUndefined();
    expect(
      modelFromConfigOptions(
        opt({
          type: "select",
          id: "mode",
          category: "mode",
          currentValue: "default",
          options: [],
        }),
      ),
    ).toBeUndefined();
  });
});
