import { describe, expect, it } from "vitest";
import { activityLine, compactCount, durationText } from "./member-activity";

describe("the words for a member's activity", () => {
  it("shortens counts and durations", () => {
    expect([0, 999, 1234, 12000, 2_500_000].map(compactCount)).toEqual(["0", "999", "1.2k", "12k", "2.5M"]);
    expect([5, 59.6, 130, 3720].map(durationText)).toEqual(["5s", "1m 0s", "2m 10s", "1h 2m"]);
  });

  it("reads what a command used", () => {
    const record = { kind: "command.run", summary: "modernize:build", detail: { inputTokens: 12300, outputTokens: 3400, turns: 5, durationSeconds: 130, model: "claude-opus-5-5" } };
    expect(activityLine(record)).toBe("modernize:build · 12.3k in / 3.4k out · 5 turns · 2m 10s · claude-opus-5-5");
  });

  it("reads what a build produced, and falls back to the summary", () => {
    expect(activityLine({ kind: "build.test", summary: "billing/tax", detail: { cases: 12, failed: 1, canary: "killed" } })).toBe("billing/tax · 12 cases, 1 failed · canary killed");
    expect(activityLine({ kind: "build.mr", summary: "billing/tax", detail: { cases: 1 } })).toBe("billing/tax · 1 case");
    expect(activityLine({ kind: "note", summary: "Reviewed", detail: { documents: 3 } })).toBe("Reviewed");
    expect(activityLine({ kind: "note", summary: "", detail: {} })).toBe("—");
  });
});
