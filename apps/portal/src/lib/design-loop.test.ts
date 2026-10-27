import { describe, expect, it } from "vitest";
import { designLoopOf, findingCounts, roundsOf, stopExplanation } from "./design-loop";

const finding = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "aaa",
  severity: "blocker",
  category: "fidelity",
  source: "review",
  document: "logic.md",
  section: "Rules",
  finding: "RULE-4 has no row.",
  suggestion: "Add it.",
  status: "open",
  firstRound: 1,
  lastRound: 2,
  ...overrides,
});

const report = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  report: {
    version: 1,
    set: "detail",
    round: 2,
    stop: "stalled",
    open: 1,
    resolvedTotal: 1,
    rounds: [
      { round: 1, open: 2, fixed: 1, resolved: 0 },
      { round: 2, open: 1, fixed: 1, resolved: 1 },
    ],
    clusters: [{ id: "c1", units: ["pay/run", "pay/rates"], reviewed: true }],
    coverage: { total: 3, covered: 2, uncovered: ["REQ-9"] },
    units: [{ unit: "pay/run", kind: "screen", state: "ready-with-findings", reviewed: true, findings: [finding(), finding({ id: "bbb", status: "fixed", severity: "major", lastRound: 1 })] }],
    ...overrides,
  },
});

describe("design loop of a run", () => {
  it("reads rounds, the stop, coverage, clusters and each finding with its status", () => {
    const loop = designLoopOf(report())!;
    expect([loop.set, loop.round, loop.stop, loop.open, loop.resolvedTotal]).toEqual(["detail", 2, "stalled", 1, 1]);
    expect(loop.rounds.map((entry) => entry.open)).toEqual([2, 1]);
    expect(loop.clusters).toEqual([{ id: "c1", units: ["pay/run", "pay/rates"], reviewed: true }]);
    expect(loop.coverage).toEqual({ total: 3, covered: 2, uncovered: ["REQ-9"] });
    expect(loop.units[0]!.findings.map((entry) => [entry.id, entry.status, entry.severity])).toEqual([["aaa", "open", "blocker"], ["bbb", "fixed", "major"]]);
    expect(findingCounts(loop.units[0]!)).toEqual({ open: 1, fixed: 1 });
  });

  it("is undefined for a run that kept no loop, and tolerant of a malformed one", () => {
    expect(designLoopOf(undefined)).toBeUndefined();
    expect(designLoopOf({ files: 3 })).toBeUndefined();
    expect(designLoopOf({ report: { version: 2 } })).toBeUndefined();
    const loop = designLoopOf(report({ stop: "whatever", rounds: "x", units: [{ unit: "" }, null, { unit: "a/b", findings: [{ severity: "weird" }, finding()] }], coverage: null }))!;
    expect([loop.stop, loop.rounds, loop.coverage, loop.units.map((unit) => unit.unit), loop.units[0]!.findings.length]).toEqual(["none", [], undefined, ["a/b"], 1]);
  });

  it("says why the loop stopped and which rounds a finding was seen in", () => {
    const loop = designLoopOf(report())!;
    expect(stopExplanation(loop)).toContain("did not improve over two rounds");
    expect(stopExplanation({ ...loop, stop: "clean" })).toContain("verified after its fixes");
    expect(stopExplanation({ ...loop, stop: "limit" })).toContain("last fix was not reviewed again");
    expect(roundsOf({ firstRound: 2, lastRound: 2 })).toBe("round 2");
    expect(roundsOf({ firstRound: 1, lastRound: 3 })).toBe("rounds 1–3");
    expect(roundsOf({ firstRound: 0, lastRound: 0 })).toBe("");
  });
});
