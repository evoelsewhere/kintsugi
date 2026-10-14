// The Overview of understand results: how big the units and modules are, how far the
// specifications and work items have come, how much of the rules and findings the units cover
// (the traceability), and the units that matter most (largest, most depended-on).

import { BarList, Donut, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import type { UnderstandResults } from "@/lib/api/documents";
import { countBy, domainColors, formatCount, percentOf, segmentsOf } from "./results-format";
import { Distribution, MoreLink, Section, Signal, SignalList } from "./results-parts";

const WORK_ITEM_COLOR: Record<string, string> = {
  pending: CHART_COLOR.muted,
  "in-progress": CHART_COLOR.blue,
  "awaiting-review": CHART_COLOR.orange,
  approved: CHART_COLOR.green,
  done: CHART_COLOR.green,
  rejected: CHART_COLOR.red,
  blocked: CHART_COLOR.red,
  skipped: CHART_COLOR.muted,
  proposed: CHART_COLOR.purple,
};

export function UnderstandOverview({ results, onOpen, onMatrix }: { results: UnderstandResults; onOpen: (id: string) => void; onMatrix: () => void }): React.JSX.Element {
  const { units, matrix } = results;
  const modules = countBy(units, (unit) => unit.module);
  const colors = domainColors(modules.map((entry) => entry.key));
  const locByModule = [...units.reduce((sum, unit) => sum.set(unit.module, (sum.get(unit.module) ?? 0) + unit.loc), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const totalLoc = locByModule.reduce((sum, [, loc]) => sum + loc, 0);
  const written = units.filter((unit) => unit.spec !== null).length;
  const workItems = countBy(units, (unit) => unit.workItem?.status ?? "no work item");
  const largest = [...units].sort((a, b) => b.loc - a.loc).slice(0, 10);
  const depended = [...units].sort((a, b) => b.usedBy.length - a.usedBy.length).filter((unit) => unit.usedBy.length > 0).slice(0, 10);
  const entryUnits = units.filter((unit) => unit.entryPoint).length;
  const rulesCovered = matrix?.rulesCovered.length ?? 0;
  const rulesMissing = matrix?.unmappedRules.length ?? 0;
  const findingsMapped = matrix?.findingsMapped.length ?? 0;
  const findingsMissing = matrix?.unmappedFindings.length ?? 0;
  const rulesPerModule = countBy(
    units.flatMap((unit) => unit.rules.map(() => unit.module)),
    (module) => module,
  ).slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Code by module" description="Lines of the files the units cite, summed per module." className="lg:col-span-3">
          <Donut
            segments={locByModule.slice(0, 7).map(([module, loc]) => ({ label: module, value: loc, color: colors.get(module) ?? CHART_COLOR.muted }))}
            format={formatCount}
            center={formatCount(totalLoc)}
            caption="lines"
          />
        </Section>
        <Section title="Signals" description="Figures derived from the traceability matrix." className="lg:col-span-2" actions={matrix === null ? undefined : <MoreLink label="Traceability" onClick={onMatrix} />}>
          <SignalList>
            <Signal label="Units per module" value={modules.length === 0 ? "—" : (units.length / modules.length).toFixed(1)} note={`${formatCount(units.length)} units, ${formatCount(modules.length)} modules`} />
            <Signal label="Specifications written" value={percentOf(written, units.length)} note={`${written} of ${units.length}`} />
            <Signal label="Units with an entry point" value={formatCount(entryUnits)} note={percentOf(entryUnits, units.length)} />
            <Signal label="Dependency cycles" value={formatCount(matrix?.cycles.length ?? 0)} note={matrix === null ? undefined : "between units"} />
            <Signal label="Open questions" value={formatCount(units.reduce((sum, unit) => sum + unit.openQuestions, 0))} note="in the specifications" />
            <Signal label="Left out by the merge" value={formatCount(Object.values(matrix?.notes ?? {}).reduce((sum, value) => sum + value, 0))} />
          </SignalList>
        </Section>
      </div>

      <Section title="Progress and coverage" description="How far the units are, and how much of the rules and findings they account for.">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Distribution title="Specifications" count={units.length}>
            <ShareBar
              segments={[
                { label: "Written", value: written, color: CHART_COLOR.green },
                { label: "Not written", value: units.length - written, color: CHART_COLOR.orange },
              ]}
              format={formatCount}
            />
          </Distribution>
          <Distribution title="Work items" count={units.length}>
            <ShareBar segments={segmentsOf(workItems, (key) => WORK_ITEM_COLOR[key])} format={formatCount} />
          </Distribution>
          {matrix === null || !matrix.inputs.businessRules ? null : (
            <Distribution title="Business rules" count={rulesCovered + rulesMissing}>
              <ShareBar
                segments={[
                  { label: "Applied by a unit", value: rulesCovered, color: CHART_COLOR.green },
                  { label: "Applied by none", value: rulesMissing, color: CHART_COLOR.orange },
                ]}
                format={formatCount}
              />
            </Distribution>
          )}
          {matrix === null || !matrix.inputs.securityFindings ? null : (
            <Distribution title="Security findings" count={findingsMapped + findingsMissing}>
              <ShareBar
                segments={[
                  { label: "Located in a unit", value: findingsMapped, color: CHART_COLOR.green },
                  { label: "In no unit", value: findingsMissing, color: CHART_COLOR.orange },
                ]}
                format={formatCount}
              />
            </Distribution>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Largest units" description="By lines of the files they cite.">
          <BarList format={formatCount} onSelect={(row) => onOpen(row.key)} rows={largest.map((unit) => ({ key: unit.id, label: unit.title, title: unit.key, value: unit.loc, note: unit.module, color: colors.get(unit.module) ?? CHART_COLOR.blue }))} />
        </Section>
        <Section title="Most depended-on units" description="Units that the most other units use: change them with care.">
          {depended.length === 0 ? (
            <p className="text-[12px] text-text-muted">No unit depends on another.</p>
          ) : (
            <BarList format={formatCount} color={CHART_COLOR.teal} onSelect={(row) => onOpen(row.key)} rows={depended.map((unit) => ({ key: unit.id, label: unit.title, title: unit.key, value: unit.usedBy.length, note: unit.module }))} />
          )}
        </Section>
      </div>

      {rulesPerModule.length === 0 ? null : (
        <Section title="Business rules by module" description="How many rules the units of each module apply.">
          <BarList format={formatCount} rows={rulesPerModule.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count, color: colors.get(entry.key) ?? CHART_COLOR.blue }))} />
        </Section>
      )}
    </div>
  );
}
