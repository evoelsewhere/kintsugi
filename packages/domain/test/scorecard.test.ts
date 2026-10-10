import { describe, expect, it } from "vitest";
import { recommendDispositions, weightedScore } from "../src/index.js";

describe("scorecard", () => {
  it("weights criterion scores and treats missing scores as zero", () => {
    expect(
      weightedScore([
        { key: "value", group: "business", weight: 0.5, score: 8 },
        { key: "debt", group: "technical", weight: 0.5 },
      ]),
    ).toBe(4);
  });

  it("maps the total to a priority band", () => {
    expect(recommendDispositions(8).priority).toBe("low");
    expect(recommendDispositions(5).priority).toBe("medium");
    expect(recommendDispositions(2).candidates).toContain("rebuild");
  });
});
