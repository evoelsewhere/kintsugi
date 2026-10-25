// The Overview of extract-rules results: how the rules split by category, priority and
// confidence, the review load (SME questions, suspected defects, duplicates), where the rules
// come from in the source.

import { BarList, Donut, Heatmap, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { InlineText } from "@/components/results/inline-text";
import type { CatalogRule, RulesResults } from "@/lib/api/documents";
import { CONFIDENCE_COLOR, countBy, formatCount, percentOf, PRIORITY_COLOR, segmentsOf, topWithOthers } from "./results-format";
import { Distribution, MoreLink, Section, Signal, SignalList } from "./results-parts";

const STATUS_COLOR: Record<string, string> = { confirmed: CHART_COLOR.green, unverified: CHART_COLOR.orange, refuted: CHART_COLOR.red };

/** The source file of a rule: its first citation, else its Source line without line numbers. */
const fileOf = (rule: CatalogRule): string | undefined => rule.citations[0]?.path ?? rule.source?.replace(/[:#(].*$/, "").trim();

const priorityOf = (rule: CatalogRule): string => (rule.priority === "" ? "—" : rule.priority);
const categoryOf = (rule: CatalogRule): string => rule.category ?? "(none)";

export function RulesOverview({ results, onCoverage }: { results: RulesResults; onCoverage: () => void }): React.JSX.Element {
  const active = results.rules.filter((rule) => rule.status !== "refuted");
  const categories = countBy(active, categoryOf);
  const priorities = countBy(active, priorityOf).sort((a, b) => a.key.localeCompare(b.key));
  const confidences = countBy(active, (rule) => rule.confidence ?? "—");
  const statuses = countBy(results.rules, (rule) => rule.status);
  const sources = countBy(active, fileOf).slice(0, 10);
  const smeQuestions = active.filter((rule) => rule.smeQuestion !== undefined).length;
  const defects = active.filter((rule) => rule.suspectedDefect !== undefined).length;
  const duplicates = new Set(active.flatMap((rule) => rule.duplicateGroup ?? [])).size;
  const lowConfidence = active.filter((rule) => rule.confidence !== undefined && rule.confidence !== "High").length;
  const categoryNames = categories.map((entry) => entry.key);
  const priorityNames = priorities.map((entry) => entry.key);
  const grid = categoryNames.map((category) => priorityNames.map((priority) => active.filter((rule) => categoryOf(rule) === category && priorityOf(rule) === priority).length));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Rules by category" description="Confirmed and unverified rules; refuted candidates are left out." className="lg:col-span-3">
          <Donut segments={segmentsOf(topWithOthers(categories, 7))} format={formatCount} center={formatCount(active.length)} caption="rules" />
        </Section>
        <Section title="Review load" description="What a subject-matter expert still has to look at." className="lg:col-span-2">
          <SignalList>
            <Signal label="SME questions" value={formatCount(smeQuestions)} note={percentOf(smeQuestions, active.length)} />
            <Signal label="Suspected defects" value={formatCount(defects)} note={percentOf(defects, active.length)} />
            <Signal label="Below High confidence" value={formatCount(lowConfidence)} note={percentOf(lowConfidence, active.length)} />
            <Signal label="Duplicate groups" value={formatCount(duplicates)} note="same lines or names" />
            <Signal label="Refuted by a verifier" value={formatCount(statuses.find((entry) => entry.key === "refuted")?.count ?? 0)} />
          </SignalList>
        </Section>
      </div>

      <Section title="Mix" description="How the rules split by priority, confidence and verification status.">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Distribution title="Priority" count={active.length}>
            <ShareBar segments={segmentsOf(priorities, (key) => PRIORITY_COLOR[key])} format={formatCount} />
          </Distribution>
          <Distribution title="Confidence" count={active.length}>
            <ShareBar segments={segmentsOf(confidences, (key) => CONFIDENCE_COLOR[key])} format={formatCount} />
          </Distribution>
          <Distribution title="Status" count={results.rules.length}>
            <ShareBar segments={segmentsOf(statuses, (key) => STATUS_COLOR[key])} format={formatCount} />
          </Distribution>
        </div>
      </Section>

      {categoryNames.length < 2 || priorityNames.length < 2 ? null : (
        <Section title="Category by priority" description="Where the P0 rules are: darker cells hold more rules.">
          <Heatmap rows={categoryNames} columns={priorityNames} values={grid} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Rules by source file" description="Files that carry the most rules: the business logic is concentrated here.">
          {sources.length === 0 ? (
            <p className="text-[12px] text-text-muted">The rules cite no source file.</p>
          ) : (
            <BarList format={formatCount} rows={sources.map((entry) => ({ key: entry.key, label: entry.key.split("/").slice(-2).join("/"), title: entry.key, value: entry.count, mono: true }))} />
          )}
        </Section>
      </div>

      {results.coverageGaps.length === 0 ? null : (
        <Section title="Coverage gaps" description="Parts of the code the extraction could not cover." actions={<MoreLink label="All gaps" onClick={onCoverage} />}>
          <ul className="flex flex-col gap-2 text-[13px] leading-6 text-text-secondary">
            {results.coverageGaps.slice(0, 4).map((gap) => (
              <li key={gap} className="flex gap-2">
                <span className="mt-2.5 size-1 shrink-0 rounded-full bg-text-muted" />
                <InlineText text={gap} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
