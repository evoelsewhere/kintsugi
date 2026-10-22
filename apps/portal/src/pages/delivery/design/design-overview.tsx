// Design → Overview: where the design of the application stands, results first. A tile per set,
// how each set's units split by state (each state opens the Units tab filtered to it), what needs
// attention, and the units ready to be designed next, each with a button that generates its set (ADR-0049).

import { AlertTriangle, Play } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { DesignOverview, DesignState, UnitSetActivity } from "@/lib/api/design";
import { applicationEligibility, eligibility } from "@/lib/design-run";
import { APPLICATION_UNIT_KEY } from "@kintsugi/domain";
import { CountChip, Kpi, KpiRow, MoreLink, Section, Signal, SignalList } from "../results/results-parts";
import type { RequestGenerate } from "./design-stage";
import { STATE_LABEL, STATE_ORDER, STATE_TONE, setLabel } from "./design-state";

const BAR_COLOR: Record<DesignState, string> = {
  conformant: "var(--ds-status-green)",
  problems: "var(--ds-status-red)",
  stale: "var(--ds-status-orange)",
  missing: "var(--color-hover)",
  waived: "var(--ds-text-muted)",
  "not-applicable": "transparent",
};

/** How many ready-to-design units the overview lists before pointing to the Units tab. */
const READY_SHOWN = 6;

export function DesignOverviewTab({
  overview,
  activity,
  runDisabled,
  onGenerate,
  onOpenUnits,
  onOpenUnit,
  onOpenSets,
}: {
  overview: DesignOverview;
  /** The units a run is generating or a pull request carries, per set. */
  activity: readonly UnitSetActivity[];
  /** Why no run can start (permission, repositories); undefined when one can. */
  runDisabled: string | undefined;
  onGenerate: RequestGenerate;
  /** Opens the Units tab filtered to a set and a state. */
  onOpenUnits: (set: string, state: DesignState | "") => void;
  onOpenUnit: (key: string) => void;
  onOpenSets: () => void;
}): React.JSX.Element {
  const { sets, units, counts, rules, attention } = overview;
  const ready = useMemo(
    () =>
      [
        ...sets.filter((set) => applicationEligibility(overview, set, activity).ok).map((set) => ({ key: APPLICATION_UNIT_KEY, title: "the application", wave: undefined as string | undefined, set: set.id })),
        ...units.flatMap((unit) => sets.filter((set) => eligibility(unit, set, activity).ok).map((set) => ({ key: unit.key, title: unit.title, wave: unit.wave, set: set.id }))),
      ].sort((a, b) => (a.wave ?? "~").localeCompare(b.wave ?? "~", undefined, { numeric: true }) || a.key.localeCompare(b.key)),
    [overview, units, sets, activity],
  );
  const covered = rules.total === 0 ? undefined : Math.round(((rules.total - rules.uncovered) / rules.total) * 100);
  const stale = units.filter((unit) => Object.values(unit.sets).some((summary) => summary.files.stale > 0)).length;

  if (sets.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No design sets yet"
          description="A design set defines what one design document of a unit contains. Define the project's sets in 01-standards/templates/ of the document repo: the starter has a basic, a detail, an API and a test design to copy and change."
          action={
            <button type="button" onClick={onOpenSets} className="text-[13px] text-accent hover:underline">
              Open the Sets tab
            </button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Units" value={units.length} hint="with a unit file" />
        {sets.map((set) => {
          const here = counts[set.id] ?? {};
          const total = Object.values(here).reduce((sum, value) => sum + (value ?? 0), 0);
          const done = (here.conformant ?? 0) + (here.waived ?? 0) + (here.stale ?? 0);
          return <Kpi key={set.id} label={set.title} value={done} display={`${done}/${total}`} hint={`${setLabel(set)} written`} tone={done === total && total > 0 ? "green" : "muted"} />;
        })}
        <Kpi label="Stale" value={stale} hint="older version of a set" tone={stale > 0 ? "orange" : "muted"} />
        <Kpi label="Rules covered" value={covered} display={covered === undefined ? "—" : `${covered}%`} hint={rules.units === 0 ? "no design lists rules yet" : `${rules.units} unit(s) with a design`} tone={rules.uncovered > 0 ? "orange" : covered === undefined ? "muted" : "green"} />
      </KpiRow>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Progress by set" description="Each set's units by state; a state opens the Units tab on it.">
          <div className="flex flex-col gap-5">
            {sets.map((set) => {
              const here = counts[set.id] ?? {};
              const total = STATE_ORDER.reduce((sum, state) => sum + (here[state] ?? 0), 0);
              return (
                <div key={set.id} className="flex flex-col gap-2">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-text">
                    <span className="font-medium">{set.title}</span>
                    <span className="font-mono text-[11.5px] text-text-muted">{setLabel(set)}</span>
                    {set.needs.length === 0 ? null : <span className="text-[11.5px] text-text-muted">after {set.needs.join(", ")}</span>}
                  </p>
                  <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-hover" role="img" aria-label={STATE_ORDER.map((state) => `${STATE_LABEL[state]} ${here[state] ?? 0}`).join(", ")}>
                    {STATE_ORDER.filter((state) => (here[state] ?? 0) > 0).map((state) => (
                      <span key={state} className="h-full min-w-[3px]" style={{ width: `${((here[state] ?? 0) / total) * 100}%`, backgroundColor: BAR_COLOR[state] }} title={`${STATE_LABEL[state]}: ${here[state]}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {total === 0 ? <span className="text-[12px] text-text-muted">No unit of a kind this set applies to.</span> : null}
                    {STATE_ORDER.filter((state) => (here[state] ?? 0) > 0).map((state) => (
                      <CountChip key={state} label={STATE_LABEL[state]} count={here[state] ?? 0} tone={STATE_TONE[state]} onClick={() => onOpenUnits(set.id, state)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Needs attention" description="What a person has to look at.">
          {attention.length === 0 ? (
            <p className="text-[13px] text-text-secondary">Nothing: every design written conforms to its template and every reference resolves.</p>
          ) : (
            <ul className="flex flex-col gap-2.5 text-[13px]">
              {attention.map((entry) => (
                <li key={entry.kind} className="flex items-start gap-2 text-text-secondary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">{entry.label}</span>
                  {entry.kind === "template-error" ? <MoreLink label="Sets" onClick={onOpenSets} /> : null}
                  {entry.kind === "uncovered-rules" ? <MoreLink label="Coverage" onClick={() => onOpenUnits("", "")} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Ready to design next" description="Units (and the application, for a set of the whole application) whose earlier sets are written and whose own set is not started, by wave. Generate a set here, or select several units on the Units tab.">
        {ready.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No unit is waiting: every unit with its earlier sets written has started its next one.</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {ready.slice(0, READY_SHOWN).map((entry) => (
                <li key={`${entry.key}/${entry.set}`} className="flex items-center gap-3 py-1.5 [box-shadow:0_-1px_0_0_var(--color-hover)] first:shadow-none">
                  <button type="button" onClick={() => onOpenUnit(entry.key)} className="min-w-0 flex-1 truncate text-left text-[13px] text-text hover:underline">
                    {entry.key}
                    {entry.title === undefined || entry.title === entry.key.split("/")[1] ? null : <span className="ml-2 text-text-muted">{entry.title}</span>}
                  </button>
                  {entry.wave === undefined ? null : <span className="text-[11.5px] text-text-muted">wave {entry.wave}</span>}
                  <span className="font-mono text-[11.5px] text-text-secondary">{entry.set}</span>
                  <Button size="small" variant="ghost" className="shadow-border" disabled={runDisabled !== undefined} title={runDisabled} onClick={() => onGenerate(entry.set, [entry.key])}>
                    <Play className="size-3.5" />
                    Generate
                  </Button>
                </li>
              ))}
            </ul>
            {ready.length > READY_SHOWN ? (
              <div className="mt-2 flex justify-end">
                <MoreLink label={`${ready.length - READY_SHOWN} more in Units`} onClick={() => onOpenUnits("", "missing")} />
              </div>
            ) : null}
          </>
        )}
      </Section>

      {rules.total > 0 ? (
        <Section title="Rule coverage" description="Rules of the units that have a design listing rules.">
          <SignalList>
            <Signal label="Rules in those units" value={String(rules.total)} />
            <Signal label="Not named by any written design" value={String(rules.uncovered)} note={covered === undefined ? undefined : `${100 - covered}%`} />
          </SignalList>
        </Section>
      ) : null}
    </div>
  );
}
