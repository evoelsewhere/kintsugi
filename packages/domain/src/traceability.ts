export type RuleId = string;
export type RequirementId = string;

export interface RuleRecord {
  id: RuleId;
  [field: string]: unknown;
}

export interface RulesFileRecord {
  rules: RuleRecord[];
}

export const RULE_REVIEW_VERDICTS = ["confirmed", "refuted", "clarify"] as const;
export type RuleReviewVerdict = (typeof RULE_REVIEW_VERDICTS)[number];

export interface RuleReviewRecord {
  verdict: RuleReviewVerdict;
  approver: string;
  date: string;
}

/** A unit's `rules-review.md`: review details are keyed by the rule id. */
export type RulesReviewRecord = Record<RuleId, RuleReviewRecord>;

export interface RequirementRecord {
  id: RequirementId;
  title?: string;
  text: string;
  derivedFrom: RuleId[];
}

export interface TraceDependencyRecord {
  target: string;
  kind: string;
  direction?: string;
}

/** A unit's traceability data, including the original understand-stage fields. */
export interface UnitTraceRecord {
  entryPoints?: string[];
  rulesApplied?: RuleId[];
  findings?: string[];
  dependencies?: TraceDependencyRecord[];
  dataObjects?: string[];
  externalSystems?: string[];
  files?: string[];
  openQuestions?: number;
  requirements: RequirementId[];
  pullRequests: string[];
  tests: string[];
}

export interface TraceabilityProblem {
  path: string;
  message: string;
}

export interface RuleRequirementTraceChain {
  rules: readonly RuleRecord[];
  reviews: RulesReviewRecord;
  requirements: readonly RequirementRecord[];
  trace: UnitTraceRecord;
}

const REQUIREMENT_HEADING = /^#{2,6}\s+(REQ-[A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*(?:[—–:-]\s*|\s+)(.*))?\s*$/;
const DERIVED_FROM = /^\s*(?:[-+]\s+|\*\s+)?(?:\*\*)?derived(?:\s+from|From)(?:\*\*)?\s*:\s*(.*?)\s*$/i;

/** Parse requirement sections headed by `REQ-…`; source Rule IDs use a `derivedFrom:` line. */
export function parseRequirementsMarkdown(markdown: string): RequirementRecord[] {
  const requirements: RequirementRecord[] = [];
  let current: { id: string; title?: string; lines: string[] } | undefined;

  const finish = (): void => {
    if (current === undefined) return;
    const derivedFrom: string[] = [];
    const text: string[] = [];
    for (const line of current.lines) {
      const source = DERIVED_FROM.exec(line);
      if (source !== null) {
        derivedFrom.push(
          ...source[1]!
            .split(/[,;]/)
            .map((id) => id.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9._-]+$/g, ""))
            .filter(Boolean),
        );
      } else {
        text.push(line);
      }
    }
    requirements.push({
      id: current.id,
      ...(current.title === undefined ? {} : { title: current.title }),
      text: text.join("\n").trim(),
      derivedFrom,
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = REQUIREMENT_HEADING.exec(line);
    if (heading !== null) {
      finish();
      const title = heading[2]?.trim();
      current = {
        id: heading[1]!,
        ...(title === undefined || title === "" ? {} : { title }),
        lines: [],
      };
    } else if (current !== undefined) {
      current.lines.push(line);
    }
  }
  finish();
  return requirements;
}

/** Rule-review entries whose ids do not occur in the supplied rules file. */
export function findOrphanRuleReviewIds(
  rules: readonly Pick<RuleRecord, "id">[],
  reviews: RulesReviewRecord,
): RuleId[] {
  const ruleIds = new Set(rules.map(({ id }) => id));
  return Object.keys(reviews)
    .filter((ruleId) => !ruleIds.has(ruleId))
    .sort();
}

/** Validate references through the rule → review → requirement → unit trace chain. */
export function validateRuleRequirementTraceChain(chain: RuleRequirementTraceChain): TraceabilityProblem[] {
  const problems: TraceabilityProblem[] = [];
  const ruleIds = new Set<RuleId>();
  for (const [index, rule] of chain.rules.entries()) {
    if (ruleIds.has(rule.id)) {
      problems.push({ path: `rules[${index}].id`, message: `duplicate rule id '${rule.id}'` });
    }
    ruleIds.add(rule.id);
  }

  for (const ruleId of findOrphanRuleReviewIds(chain.rules, chain.reviews)) {
    problems.push({ path: `rules-review.md.${ruleId}`, message: `review has no matching rule '${ruleId}'` });
  }

  const traceRuleIds = new Set(chain.trace.rulesApplied ?? []);
  const traceRequirementIds = new Set(chain.trace.requirements);
  const requirementIds = new Set<RequirementId>();
  for (const [index, requirement] of chain.requirements.entries()) {
    if (requirementIds.has(requirement.id)) {
      problems.push({ path: `requirements[${index}].id`, message: `duplicate requirement id '${requirement.id}'` });
    }
    requirementIds.add(requirement.id);
    for (const ruleId of requirement.derivedFrom) {
      if (!ruleIds.has(ruleId)) {
        problems.push({
          path: `requirements[${index}].derivedFrom`,
          message: `unknown rule id '${ruleId}'`,
        });
        continue;
      }
      const review = chain.reviews[ruleId];
      if (review === undefined) {
        problems.push({
          path: `requirements[${index}].derivedFrom`,
          message: `rule '${ruleId}' has no review verdict`,
        });
      } else if (review.verdict !== "confirmed") {
        problems.push({
          path: `requirements[${index}].derivedFrom`,
          message: `rule '${ruleId}' is not confirmed`,
        });
      }
    }
    if (
      !traceRequirementIds.has(requirement.id) &&
      requirement.derivedFrom.some((ruleId) => traceRuleIds.has(ruleId))
    ) {
      problems.push({
        path: "trace.requirements",
        message: `requirement '${requirement.id}' derived from a traced rule is not listed in trace.requirements`,
      });
    }
  }

  for (const [index, ruleId] of (chain.trace.rulesApplied ?? []).entries()) {
    if (!ruleIds.has(ruleId)) {
      problems.push({ path: `trace.rulesApplied[${index}]`, message: `unknown rule id '${ruleId}'` });
    }
  }

  for (const [index, requirementId] of chain.trace.requirements.entries()) {
    const requirement = chain.requirements.find(({ id }) => id === requirementId);
    if (requirement === undefined) {
      problems.push({
        path: `trace.requirements[${index}]`,
        message: `unknown requirement id '${requirementId}'`,
      });
      continue;
    }
    for (const ruleId of requirement.derivedFrom) {
      if (!traceRuleIds.has(ruleId)) {
        problems.push({
          path: `trace.requirements[${index}]`,
          message: `requirement '${requirementId}' is derived from rule '${ruleId}' not listed in trace.rulesApplied`,
        });
      }
    }
  }

  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined | null {
  const value = record[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : null;
}

function readDependencies(record: Record<string, unknown>): TraceDependencyRecord[] | undefined | null {
  const value = record["dependencies"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const dependencies: TraceDependencyRecord[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item["target"] !== "string" || typeof item["kind"] !== "string") return null;
    if (item["direction"] !== undefined && typeof item["direction"] !== "string") return null;
    dependencies.push({
      target: item["target"],
      kind: item["kind"],
      ...(typeof item["direction"] === "string" ? { direction: item["direction"] } : {}),
    });
  }
  return dependencies;
}

/** Narrow a record read from a unit's `trace.md` (the three link arrays default to empty). */
export function parseUnitTrace(value: unknown): UnitTraceRecord | undefined {
  if (!isRecord(value)) return undefined;

  const entryPoints = readStringArray(value, "entryPoints");
  const rulesApplied = readStringArray(value, "rulesApplied");
  const findings = readStringArray(value, "findings");
  const dependencies = readDependencies(value);
  const dataObjects = readStringArray(value, "dataObjects");
  const externalSystems = readStringArray(value, "externalSystems");
  const files = readStringArray(value, "files");
  const requirements = readStringArray(value, "requirements");
  const pullRequests = readStringArray(value, "pullRequests");
  const tests = readStringArray(value, "tests");
  const openQuestions = value["openQuestions"];

  if (
    entryPoints === null || rulesApplied === null || findings === null || dependencies === null ||
    dataObjects === null || externalSystems === null || files === null || requirements === null ||
    pullRequests === null || tests === null ||
    (openQuestions !== undefined && typeof openQuestions !== "number")
  ) {
    return undefined;
  }

  return {
    ...(entryPoints === undefined ? {} : { entryPoints }),
    ...(rulesApplied === undefined ? {} : { rulesApplied }),
    ...(findings === undefined ? {} : { findings }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(dataObjects === undefined ? {} : { dataObjects }),
    ...(externalSystems === undefined ? {} : { externalSystems }),
    ...(files === undefined ? {} : { files }),
    ...(openQuestions === undefined ? {} : { openQuestions }),
    requirements: requirements ?? [],
    pullRequests: pullRequests ?? [],
    tests: tests ?? [],
  };
}

/** Narrow a record read from a unit's `rules.md` to a rules catalog record. */
export function parseRulesFile(value: unknown): RulesFileRecord | undefined {
  if (!isRecord(value) || !Array.isArray(value["rules"])) return undefined;
  const rules: RuleRecord[] = [];
  for (const rule of value["rules"]) {
    if (!isRecord(rule) || typeof rule["id"] !== "string") return undefined;
    rules.push({ ...rule, id: rule["id"] });
  }
  return { rules };
}

/** Narrow a record read from a unit's `rules-review.md` to verdicts keyed by rule id. */
export function parseRulesReview(value: unknown): RulesReviewRecord | undefined {
  if (!isRecord(value)) return undefined;
  const reviews: RulesReviewRecord = {};
  for (const [ruleId, review] of Object.entries(value)) {
    if (
      !isRecord(review) ||
      typeof review["verdict"] !== "string" ||
      !(RULE_REVIEW_VERDICTS as readonly string[]).includes(review["verdict"]) ||
      typeof review["approver"] !== "string" ||
      typeof review["date"] !== "string"
    ) {
      return undefined;
    }
    reviews[ruleId] = {
      verdict: review["verdict"] as RuleReviewVerdict,
      approver: review["approver"],
      date: review["date"],
    };
  }
  return reviews;
}

