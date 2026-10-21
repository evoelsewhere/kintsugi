import { describe, expect, it } from "vitest";
import type { ProviderView, SupportedProviders } from "./api/providers";
import { modelThinkingLevels } from "./model-options";

const supported = {
  builtin: [
    {
      id: "anthropic",
      models: [
        { id: "opus", reasoning: true, thinkingLevels: ["off", "minimal", "low", "medium", "high", "max"] },
        { id: "always-on", reasoning: true, thinkingLevels: ["low", "medium", "high"] },
        { id: "plain", reasoning: false, thinkingLevels: ["off"] },
      ],
    },
  ],
  customApis: [],
} as unknown as SupportedProviders;

const builtin = { id: "anthropic-main", kind: "builtin", piProvider: "anthropic" } as unknown as ProviderView;
const custom = { id: "gateway", kind: "custom", models: [{ id: "thinker", reasoning: true }, { id: "plain" }] } as unknown as ProviderView;

describe("modelThinkingLevels", () => {
  it("takes a built-in model's levels from pi's catalog, as they are", () => {
    expect(modelThinkingLevels(builtin, supported, "opus")).toEqual(["off", "minimal", "low", "medium", "high", "max"]);
    expect(modelThinkingLevels(builtin, supported, "always-on")).toEqual(["low", "medium", "high"]);
    expect(modelThinkingLevels(builtin, supported, "plain")).toEqual(["off"]);
  });

  it("lets a custom model reason up to high only when it says it reasons", () => {
    expect(modelThinkingLevels(custom, supported, "thinker")).toEqual(["off", "minimal", "low", "medium", "high"]);
    expect(modelThinkingLevels(custom, supported, "plain")).toEqual(["off"]);
  });

  it("offers nothing without a provider, a model, or a model the catalog knows", () => {
    expect(modelThinkingLevels(undefined, supported, "opus")).toEqual([]);
    expect(modelThinkingLevels(builtin, supported, "")).toEqual([]);
    expect(modelThinkingLevels(builtin, supported, "unknown")).toEqual([]);
    expect(modelThinkingLevels(builtin, undefined, "opus")).toEqual([]);
    expect(modelThinkingLevels(custom, supported, "unknown")).toEqual([]);
  });
});
