// The per-unit documents of an understand run (ADR-0033, ADR-0042) read as the facts the results views show:
// the trace links of a unit (understanding/trace.md) and the human verdicts on its rules
// (understanding/rules-review.md) against the rules it holds (understanding/rules.md). Pure functions over
// Markdown; unreadable input gives nothing.

import { parseLedger, parseRules, parseUnitTrace } from "@kintsugi/agents/reader";
import { findOrphanRuleReviewIds, type RuleId, type RulesReviewRecord } from "@kintsugi/domain";

/** A unit's trace links and rule verdicts: trace.md + rules.md + rules-review.md of its understanding folder. */
export function itemUnitFacts(
  traceText: string | null,
  rulesText: string | null,
  reviewText: string | null,
): { trace?: { requirements: string[]; pullRequests: string[]; tests: string[] }; rulesReview?: { verdicts: RulesReviewRecord; orphaned: RuleId[] } } {
  const trace = traceText === null ? undefined : parseUnitTrace(traceText);
  const verdicts: RulesReviewRecord | undefined =
    reviewText === null
      ? undefined
      : Object.fromEntries(Object.entries(parseLedger(reviewText)).map(([rule, entry]) => [rule, { verdict: entry.verdict, approver: entry.title ?? "", date: entry.at }]));
  const rules = rulesText === null ? [] : parseRules(rulesText).rules.map((rule) => ({ id: rule.id }));

  return {
    ...(trace === undefined || trace === null ? {} : { trace: { requirements: trace.requirements, pullRequests: trace.pullRequests, tests: trace.tests } }),
    ...(verdicts === undefined ? {} : { rulesReview: { verdicts, orphaned: findOrphanRuleReviewIds(rules, verdicts) } }),
  };
}
