import { describe, expect, it } from "vitest";
import { listSupportedProviders } from "../src/catalog/provider-catalog.js";

describe("provider catalog", () => {
  const models = listSupportedProviders().builtin.flatMap((provider) => provider.models);

  it("publishes the thinking levels pi accepts for every model", () => {
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) expect(model.thinkingLevels.length, model.id).toBeGreaterThan(0);
  });

  it("offers only off to a model that does not reason", () => {
    const plain = models.filter((model) => model.reasoning !== true);
    expect(plain.length).toBeGreaterThan(0);
    for (const model of plain) expect(model.thinkingLevels, model.id).toEqual(["off"]);
  });

  it("keeps the differences between reasoning models: max on some, no off on others", () => {
    expect(models.some((model) => model.thinkingLevels.includes("max"))).toBe(true);
    expect(models.some((model) => model.reasoning === true && !model.thinkingLevels.includes("off"))).toBe(true);
    expect(models.some((model) => model.thinkingLevels.includes("xhigh") && !model.thinkingLevels.includes("max"))).toBe(true);
  });
});
