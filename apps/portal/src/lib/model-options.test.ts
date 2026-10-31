import { describe, expect, it } from "vitest";
import type { ProviderView, SupportedProviders } from "./api/providers";
import { modelThinkingLevels, thinkingOptions } from "./model-options";

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

describe("thinkingOptions", () => {
  it("labels Default and every level alike, in title case", () => {
    expect(thinkingOptions(["off", "low", "medium", "high"]).map((option) => option.label)).toEqual(["Default", "Off", "Low", "Medium", "High"]);
    expect(thinkingOptions(undefined).map((option) => option.label)).toEqual(["Default", "Off", "Minimal", "Low", "Medium", "High", "Extra high", "Max"]);
  });

  it("says why Default is the only choice and keeps an unsupported current level", () => {
    expect(thinkingOptions([])[0]).toMatchObject({ hint: "Choose a model to see its reasoning levels" });
    expect(thinkingOptions(["off"])[0]).toMatchObject({ hint: "This model has no reasoning effort" });
    expect(thinkingOptions(["off"], "high").at(-1)).toEqual({ value: "high", label: "High", hint: "not supported by this model" });
  });
});
