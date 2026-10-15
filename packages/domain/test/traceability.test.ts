import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findOrphanRuleReviewIds,
  parseRequirementsMarkdown,
  parseRulesFile,
  parseRulesReview,
  parseUnitTrace,
  validateRuleRequirementTraceChain,
  type RulesReviewRecord,
} from "../src/traceability.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/traceability/${name}`, import.meta.url), "utf8");

const jsonFixture = (name: string): unknown => JSON.parse(fixture(name)) as unknown;

describe("rule, requirement, and unit traceability", () => {
  it("validates the fixture-backed rule → verdict → requirement → trace chain", () => {
    const rules = parseRulesFile(jsonFixture("rules.json"));
    const reviews = parseRulesReview(jsonFixture("rules-review.json"));
    const requirements = parseRequirementsMarkdown(fixture("requirements.md"));
    const trace = parseUnitTrace(jsonFixture("trace.json"));

    expect(rules).toBeDefined();
    expect(reviews).toBeDefined();
    expect(requirements).toEqual([
      {
        id: "REQ-INV-001",
        title: "Calculate invoice gross amount",
        text: "The gross amount must include the applicable tax.",
        derivedFrom: ["RULE-invoice-amount-001"],
      },
    ]);
    expect(trace).toMatchObject({
      requirements: ["REQ-INV-001"],
      pullRequests: ["#42"],
      tests: ["tests/invoice_gross_amount.test.ts"],
    });
    expect(
      validateRuleRequirementTraceChain({
        rules: rules!.rules,
        reviews: reviews!,
        requirements,
        trace: trace!,
      }),
    ).toEqual([]);
  });

  it("reports orphan rule reviews by rule id", () => {
    const reviews: RulesReviewRecord = {
      "RULE-invoice-amount-001": {
        verdict: "confirmed",
        approver: "A. Reviewer",
        date: "2026-10-15",
      },
      "RULE-retired-001": {
        verdict: "refuted",
        approver: "A. Reviewer",
        date: "2026-10-15",
      },
    };

    expect(findOrphanRuleReviewIds([{ id: "RULE-invoice-amount-001" }], reviews)).toEqual([
      "RULE-retired-001",
    ]);
  });

  it("rejects a requirement derived from an unconfirmed rule or absent from the trace", () => {
    const rules = parseRulesFile(jsonFixture("rules.json"))!;
    const reviews = parseRulesReview(jsonFixture("rules-review.json"))!;
    const requirements = parseRequirementsMarkdown(fixture("requirements.md"));
    const trace = parseUnitTrace(jsonFixture("trace.json"))!;
    const problems = validateRuleRequirementTraceChain({
      rules: rules.rules,
      reviews: {
        ...reviews,
        "RULE-invoice-amount-001": { ...reviews["RULE-invoice-amount-001"]!, verdict: "clarify" },
      },
      requirements,
      trace: { ...trace, rulesApplied: [] },
    });

    expect(problems.map(({ message }) => message)).toEqual([
      "rule 'RULE-invoice-amount-001' is not confirmed",
      "requirement 'REQ-INV-001' is derived from rule 'RULE-invoice-amount-001' not listed in trace.rulesApplied",
    ]);
  });

  it("reports a requirement derived from a traced rule when its trace link is missing", () => {
    const rules = parseRulesFile(jsonFixture("rules.json"))!;
    const reviews = parseRulesReview(jsonFixture("rules-review.json"))!;
    const requirements = parseRequirementsMarkdown(fixture("requirements.md"));
    const trace = parseUnitTrace(jsonFixture("trace.json"))!;

    expect(
      validateRuleRequirementTraceChain({
        rules: rules.rules,
        reviews,
        requirements,
        trace: { ...trace, requirements: [] },
      }),
    ).toEqual([
      {
        path: "trace.requirements",
        message: "requirement 'REQ-INV-001' derived from a traced rule is not listed in trace.requirements",
      },
    ]);
  });

  it("parses legacy trace files with empty new link arrays and keeps existing fields", () => {
    const trace = parseUnitTrace(jsonFixture("legacy-trace.json"));

    expect(trace).toEqual({
      entryPoints: ["INVOICE-ENTRY"],
      rulesApplied: ["RULE-invoice-amount-001"],
      findings: ["FND-invoice-tax"],
      dependencies: [],
      dataObjects: ["INVOICE-RECORD"],
      externalSystems: [],
      files: ["src/INVOICE.cbl"],
      openQuestions: 1,
      requirements: [],
      pullRequests: [],
      tests: [],
    });
  });
});
