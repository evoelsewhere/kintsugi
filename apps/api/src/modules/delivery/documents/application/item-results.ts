// The per-item files of an understand run (ADR-0033) seen as the files the stage builders read, so
// the results of one catalog item reuse the map, rules, security and traceability builders:
// rules.json → rules_result.json, findings.json → a SECURITY_FINDINGS.md table, trace.json + the
// catalog item → a one-row traceability.json. Pure functions; unreadable input gives null.

import type { ItemCatalogItem } from "@kintsugi/agents/reader";
import { findOrphanRuleReviewIds, parseRulesFile, parseRulesReview, parseUnitTrace, unitAsIsPath, type RuleId, type RulesReviewRecord } from "@kintsugi/domain";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const parse = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/** One table cell: a single line without pipes. */
const cell = (value: unknown, max = 200): string => (typeof value === "string" ? value.replace(/[\r\n|]+/g, " ").trim().slice(0, max) : "");

/** rules.json of an item as the rules_result.json the rules builder reads. */
export function itemRulesResult(text: string | null): string | null {
  const value = parse(text);
  if (value === null) return null;
  return JSON.stringify({ confirmedRules: Array.isArray(value["rules"]) ? value["rules"] : [], dataObjects: Array.isArray(value["dataObjects"]) ? value["dataObjects"] : [] });
}

const SEVERITIES = ["Critical", "High", "Medium", "Low"];

/** findings.json of an item as the SECURITY_FINDINGS.md the security builder reads. */
export function itemFindingsMarkdown(item: string, text: string | null): string | null {
  const value = parse(text);
  if (value === null) return null;
  const findings = (Array.isArray(value["findings"]) ? value["findings"] : []).filter(isRecord).filter((finding) => typeof finding["id"] === "string");
  const lines = [`# Security findings — ${item}`, "", "## Scorecard", "", "| Severity | Count |", "|---|---|"];
  for (const severity of SEVERITIES) lines.push(`| ${severity} | ${findings.filter((finding) => finding["severity"] === severity).length} |`);
  lines.push(`| **Total** | **${findings.length}** |`, "");
  const reviewed = strings(value["filesReviewed"]);
  lines.push(`**Review coverage:** manual review by the finder jobs of ${reviewed.length} file(s) of the item; no SAST, dependency-audit or secret-scanning tool ran.`, "");
  lines.push("## Findings by severity", "");
  if (findings.length === 0) lines.push("No confirmed findings in this item.");
  else {
    lines.push("| ID | CWE | Severity | Confidence | Location | Title | Exploit scenario |", "|---|---|---|---|---|---|---|");
    for (const finding of findings) {
      lines.push(`| ${cell(finding["id"])} | ${cell(finding["cwe"], 20)} | ${cell(finding["severity"], 10)} | ${cell(finding["confidence"], 10)} | \`${cell(finding["source"], 120)}\` | ${cell(finding["title"])} | ${cell(finding["exploitScenario"])} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** trace.json of an item plus its catalog entry as a one-row traceability.json (merge_traceability.py's shape). */
export function itemTraceability(app: string, item: ItemCatalogItem, traceText: string | null, specified: boolean): string {
  const trace = parse(traceText) ?? {};
  const deps = (Array.isArray(trace["dependencies"]) ? trace["dependencies"] : []).filter(isRecord).filter((dep) => typeof dep["target"] === "string");
  const [module = "", unit = ""] = item.id.split("/");
  const parsedTrace = parseUnitTrace(parse(traceText));
  const stores = new Map<string, Set<string>>();
  for (const dep of deps) {
    const target = String(dep["target"]);
    if (target.startsWith("ds:")) stores.set(target, (stores.get(target) ?? new Set()).add(typeof dep["kind"] === "string" ? dep["kind"] : "read"));
  }
  const id = `${app}/${item.id}`;
  const rules = strings(trace["rulesApplied"]);
  const findings = strings(trace["findings"]);
  const row = {
    id,
    module,
    unit,
    title: item.name,
    kind: item.kind,
    loc: item.loc,
    entryPoint: item.entryPoints.length > 0,
    spec: specified ? unitAsIsPath(app, module, unit) : null,
    files: item.files,
    dependsOn: deps.filter((dep) => dep["direction"] !== "inbound" && String(dep["target"]).includes("/")).map((dep) => `${app}/${String(dep["target"])}`),
    usedBy: deps.filter((dep) => dep["direction"] === "inbound" && String(dep["target"]).includes("/")).map((dep) => `${app}/${String(dep["target"])}`),
    dataStores: [...stores.entries()].map(([store, kinds]) => ({ id: store, access: [...kinds].sort() })),
    externalSystems: strings(trace["externalSystems"]),
    rules,
    findings,
    dataObjects: strings(trace["dataObjects"]),
    entryPoints: strings(trace["entryPoints"]),
    openQuestions: typeof trace["openQuestions"] === "number" ? trace["openQuestions"] : 0,
    requirements: parsedTrace?.requirements ?? [],
    pullRequests: parsedTrace?.pullRequests ?? [],
    tests: parsedTrace?.tests ?? [],
  };
  return JSON.stringify({
    app,
    inputs: { businessRules: true, securityFindings: true },
    units: [row],
    rules: Object.fromEntries(rules.map((rule) => [rule, [id]])),
    findings: Object.fromEntries(findings.map((finding) => [finding, [id]])),
    files: Object.fromEntries(item.files.map((file) => [file, [id]])),
    dataStores: Object.fromEntries([...stores.keys()].map((store) => [store, [id]])),
    unmappedRules: [],
    unmappedFindings: [],
    cycles: [],
    notes: {},
  });
}

/** trace.json + rules.json + rules-review.json of a unit as its trace links and its human rule verdicts. */
export function itemUnitFacts(
  traceText: string | null,
  rulesText: string | null,
  reviewText: string | null,
): { trace?: { requirements: string[]; pullRequests: string[]; tests: string[] }; rulesReview?: { verdicts: RulesReviewRecord; orphaned: RuleId[] } } {
  const trace = traceText === null ? undefined : parseUnitTrace(parse(traceText));
  const verdicts = reviewText === null ? undefined : parseRulesReview(parse(reviewText));
  return {
    ...(trace === undefined ? {} : { trace: { requirements: trace.requirements, pullRequests: trace.pullRequests, tests: trace.tests } }),
    ...(verdicts === undefined
      ? {}
      : { rulesReview: { verdicts, orphaned: findOrphanRuleReviewIds(parseRulesFile(parse(rulesText))?.rules ?? [], verdicts) } }),
  };
}
