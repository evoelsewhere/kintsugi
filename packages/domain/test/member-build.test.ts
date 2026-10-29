import { describe, expect, it } from "vitest";
import { MAX_REPORTED_RULES, memberTestReportOf } from "../src/member-build.js";

describe("memberTestReportOf", () => {
  it("keeps counts and rule ids, and drops anything else", () => {
    expect(
      memberTestReportOf({
        cases: 12,
        failed: 1,
        canary: "killed",
        rulesPassed: ["RULE-TAX01-0001", "RULE-TAX01-0001", "not a rule", 7, "RULE-tax.calc-02"],
        rulesFailed: ["RULE-TAX01-0003"],
        legacyCases: 40,
        legacyMatched: 39,
        code: "System.exit(0)",
      }),
    ).toEqual({ cases: 12, failed: 1, canary: "killed", rulesPassed: ["RULE-TAX01-0001", "RULE-tax.calc-02"], rulesFailed: ["RULE-TAX01-0003"], legacyCases: 40, legacyMatched: 39 });
  });

  it("reads the comma-separated strings an activity record carries, and * for every tested rule", () => {
    expect(memberTestReportOf({ rulesPassed: "RULE-TAX01-0001, RULE-TAX01-0002,junk", rulesFailed: "" })).toEqual({ rulesPassed: ["RULE-TAX01-0001", "RULE-TAX01-0002"], rulesFailed: [] });
    expect(memberTestReportOf({ rulesPassed: "*", rulesFailed: "RULE-TAX01-0003,*" })).toEqual({ rulesPassed: ["*"], rulesFailed: ["RULE-TAX01-0003"] });
  });

  it("refuses counts that are not counts and more matches than cases", () => {
    expect(memberTestReportOf({ cases: -1, failed: 1.5, canary: "maybe", legacyCases: 3, legacyMatched: 4, rulesPassed: 7 })).toEqual({ legacyCases: 3 });
    expect(memberTestReportOf({ rulesPassed: Array.from({ length: 600 }, (_, n) => `RULE-A-${n}`) }).rulesPassed).toHaveLength(MAX_REPORTED_RULES);
  });
});
