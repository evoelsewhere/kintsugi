import { describe, expect, it } from "vitest";
import { scorecardPriority, weightedScore } from "../src/index.js";

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
    expect(scorecardPriority(8)).toBe("low");
    expect(scorecardPriority(5)).toBe("medium");
    expect(scorecardPriority(2)).toBe("high");
  });
});
