import { describe, expect, it } from "vitest";
import { gapState } from "./results-format";

describe("gap state", () => {
  it("shows an answer waiting for review with its pull request (ADR-0094)", () => {
    expect(gapState({ openWrite: { id: "w1", status: "pr-opened", prUrl: "https://git.example.invalid/org/docs/pulls/12", prNumber: 12 } }, false)).toEqual({ label: "Answer proposed · PR #12", tone: "blue" });
    expect(gapState({ openWrite: { id: "w1", status: "queued" } }, false)).toEqual({ label: "Answer proposed", tone: "blue" });
  });

  it("is unchanged without an open correction", () => {
    expect(gapState({}, false)).toEqual({ label: "Open", tone: "orange" });
    expect(gapState({}, true)).toEqual({ label: "Resolved", tone: "green" });
  });
});
