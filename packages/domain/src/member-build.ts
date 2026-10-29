/**
 * What a member's `build` command reports of its test run (ADR-0071, ADR-0088): counts, and the ids of the rules whose tests
 * passed or failed, never code or document content. Kintsugi runs none of it: these are the member's word, and the review
 * shows them as such. One reader for the API (what it keeps of an activity record) and the orchestrator (the review scope).
 */
export interface MemberTestReport {
  /** Cases executed and failed in the member's test run. */
  cases?: number;
  failed?: number;
  /** `killed` when a deliberate break of the code turned a test red, `survived` when none did. */
  canary?: "killed" | "survived";
  /**
   * The rules whose tests passed, and those with a failing test, in that run. An activity record carries them as one
   * comma-separated string (its values are scalars of at most 500 characters); `rulesPassed` `*` means every rule a test
   * names, except the failed ones.
   */
  rulesPassed?: string[];
  rulesFailed?: string[];
  /** Cases run on both the legacy system and the new code with the same inputs, and how many gave the same result. */
  legacyCases?: number;
  legacyMatched?: number;
}

export const MAX_REPORTED_RULES = 500;
const RULE_ID = /^RULE-[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const countOf = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined);
/** Every rule a test names: the value of `rulesPassed` when a unit has more rules than a record can list. */
export const ALL_TESTED_RULES = "*";

/** Rule ids from a list or a comma-separated string; with `allTested`, `*` stands for every tested rule. */
const rulesOf = (value: unknown, allTested = false): string[] | undefined => {
  const entries = typeof value === "string" ? value.split(/[\s,]+/) : Array.isArray(value) ? value : undefined;
  if (entries === undefined) return undefined;
  if (allTested && entries.includes(ALL_TESTED_RULES)) return [ALL_TESTED_RULES];
  return [...new Set(entries.filter((entry): entry is string => typeof entry === "string" && RULE_ID.test(entry)))].slice(0, MAX_REPORTED_RULES);
};

/** The well-formed fields of a report (an activity record's details, or a run's scope); anything else is dropped. */
export function memberTestReportOf(detail: Record<string, unknown>): MemberTestReport {
  const cases = countOf(detail["cases"]);
  const failed = countOf(detail["failed"]);
  const canary = detail["canary"] === "killed" || detail["canary"] === "survived" ? detail["canary"] : undefined;
  const rulesPassed = rulesOf(detail["rulesPassed"], true);
  const rulesFailed = rulesOf(detail["rulesFailed"]);
  const legacyCases = countOf(detail["legacyCases"]);
  const legacyMatched = countOf(detail["legacyMatched"]);
  return {
    ...(cases === undefined ? {} : { cases }),
    ...(failed === undefined ? {} : { failed }),
    ...(canary === undefined ? {} : { canary }),
    ...(rulesPassed === undefined ? {} : { rulesPassed }),
    ...(rulesFailed === undefined ? {} : { rulesFailed }),
    ...(legacyCases === undefined ? {} : { legacyCases }),
    ...(legacyMatched === undefined || (legacyCases !== undefined && legacyMatched > legacyCases) ? {} : { legacyMatched }),
  };
}
