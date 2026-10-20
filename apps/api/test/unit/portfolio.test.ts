// The portfolio overview's derivations: the phase an application is in and the riskiest units.

import { describe, expect, it } from "vitest";
import { type PhaseFacts, type RiskyUnit, derivePhase, riskiestUnits } from "../../src/modules/monitoring/portfolio/domain/portfolio.js";

const facts = (extra: Partial<PhaseFacts> = {}): PhaseFacts => ({ ready: true, assessed: false, items: 0, understood: 0, designed: false, ...extra });

describe("derivePhase", () => {
  it("is mobilize until the application can run stages", () => {
    expect(derivePhase(facts({ ready: false }))).toBe("mobilize");
  });

  it("is discover-assess before and while the catalog is understood", () => {
    expect(derivePhase(facts())).toBe("discover-assess");
    expect(derivePhase(facts({ assessed: true, items: 27, understood: 0 }))).toBe("discover-assess");
    expect(derivePhase(facts({ assessed: true, items: 27, understood: 26 }))).toBe("discover-assess");
  });

  it("moves to define-to-be once every item is understood or a design succeeded", () => {
    expect(derivePhase(facts({ assessed: true, items: 27, understood: 27 }))).toBe("define-to-be");
    expect(derivePhase(facts({ assessed: true, items: 27, understood: 3, designed: true }))).toBe("define-to-be");
  });

  it("does not leave discover-assess for an empty catalog", () => {
    expect(derivePhase(facts({ assessed: true, items: 0, understood: 0 }))).toBe("discover-assess");
  });
});

const unit = (id: string, complexity: RiskyUnit["complexity"], loc: number, status: RiskyUnit["status"] = "not-analysed"): RiskyUnit => ({
  projectId: "p",
  applicationId: "a",
  id,
  name: id,
  module: id.split("/")[0]!,
  complexity,
  loc,
  status,
});

describe("riskiestUnits", () => {
  it("ranks by complexity, then size, and skips what is understood, running or in a pull request", () => {
    const ranked = riskiestUnits([
      unit("m/small-high", "high", 10),
      unit("m/big-medium", "medium", 900),
      unit("m/big-high", "high", 500),
      unit("m/done", "high", 9999, "understood"),
      unit("m/running", "high", 9999, "running"),
      unit("m/in-pr", "high", 9999, "in-pr"),
      unit("m/failed", "medium", 950, "failed"),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(["m/big-high", "m/small-high", "m/failed", "m/big-medium"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) => unit(`m/u${index}`, "low", index));
    expect(riskiestUnits(many, 5)).toHaveLength(5);
  });
});
