import { describe, expect, it } from "vitest";
import { hardenResults, type StageSource } from "#modules/delivery/documents/application/stage-results.builders.js";

const sourceOf = (files: Record<string, string>): StageSource => ({
  files: [],
  read: (name) => Promise.resolve(files[name] ?? null),
  list: () => Promise.resolve([]),
  readPath: () => Promise.resolve(null),
});

const CURRENT = `# Security Findings — billing

## Scorecard

| Severity | Count |
|---|---|
| Low | 1 |
| **Total** | **1** |

**Review coverage:** manual review of 6 files; no SAST, dependency-audit or secret-scanning tool ran.

## Coverage gaps

All 5 finder classes returned and every finding was judged.

## Findings by severity

| ID | CWE | Severity | Confidence | Location | Title |
|---|---|---|---|---|---|
| SEC-001 | CWE-862 | Low | Low | \`src/billing/AccountRepository.java:16-22\` | No authorization on find |

## Assessment carry-over

| Assessment ID | Title | Outcome | Reason |
|---|---|---|---|
| SEC-001 | Missing authorization | Confirmed as SEC-001 | find() has no ownership check |
| SEC-004 | Negative DAYS_OVERDUE | Refuted | a data-quality rule |

## Audit tools not run

| Tool | Reason |
|---|---|
| gitleaks | no shell in a runtime job |
`;

describe("hardenResults", () => {
  it("passes confidence, review coverage, the carry-over and the tools not run through", async () => {
    const results = await hardenResults(sourceOf({ "SECURITY_FINDINGS.md": CURRENT }), "10-applications/billing/_generated");
    expect(results.report?.findings[0]).toMatchObject({ id: "SEC-001", confidence: "Low" });
    expect(results.report?.reviewCoverage).toMatch(/^manual review of 6 files/);
    expect(results.report?.carryOverItems).toEqual([
      { id: "SEC-001", highlight: "Missing authorization", verdict: "confirmed", findingId: "SEC-001", reason: "find() has no ownership check" },
      { id: "SEC-004", highlight: "Negative DAYS_OVERDUE", verdict: "refuted", reason: "a data-quality rule" },
    ]);
    expect(results.report?.toolsNotRunItems).toEqual([{ tool: "gitleaks", reason: "no shell in a runtime job" }]);
  });

  it("reads an older document without the new fields", async () => {
    const results = await hardenResults(
      sourceOf({ "SECURITY_FINDINGS.md": "# F\n\n## Findings\n\n| ID | Severity | Title |\n|---|---|---|\n| SEC-001 | High | SQL injection |\n" }),
      "10-applications/billing/_generated",
    );
    expect(results.report?.findings[0]).toMatchObject({ id: "SEC-001", severity: "High" });
    expect(results.report?.findings[0]?.confidence).toBeUndefined();
    expect(results.report?.reviewCoverage).toBeUndefined();
    expect(results.report?.carryOverItems).toEqual([]);
    expect(results.report?.toolsNotRunItems).toEqual([]);
    expect(results.counts["findings"]).toBe(1);
  });
});
