// The verify loop of a design run (ADR-0083) on the run's overview: how many rounds ran, why the loop stopped, and the status of each
// finding. The facts come from the run's summary (`outputSummary.report`), kept by the worker when the run finished.

import { StatTile } from "@/components/telemetry/telemetry-parts";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import type { JobRunDetail } from "@/lib/api/job-runs";
import {
  type DesignLoop,
  type LoopFinding,
  type LoopUnit,
  SEVERITY_TONE,
  STATE_LABEL,
  STATE_TONE,
  STOP_LABEL,
  STOP_TONE,
  designLoopOf,
  findingCounts,
  roundsOf,
  stopExplanation,
} from "@/lib/design-loop";

export function RunDesignLoop({ run }: { run: JobRunDetail }): React.JSX.Element | null {
  const loop = run.name === "design" ? designLoopOf(run.outputSummary) : undefined;
  if (loop === undefined || loop.round === 0) return null;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-border sm:p-5" aria-labelledby="design-loop-heading">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="design-loop-heading" className="text-[14px] font-medium text-text">
            Verify loop
          </h2>
          <Badge>
            <StatusDot tone={STOP_TONE[loop.stop]} className="size-2" />
            {STOP_LABEL[loop.stop]}
          </Badge>
        </div>
        <p className="max-w-3xl text-[13px] text-text-secondary">{stopExplanation(loop)}</p>
      </header>
      <LoopTiles loop={loop} />
      <LoopRounds loop={loop} />
      <ul className="flex flex-col gap-2" aria-label="Units and their findings">
        {loop.units.map((unit) => (
          <UnitFindings key={unit.unit} unit={unit} />
        ))}
      </ul>
      {loop.coverage === undefined || loop.coverage.uncovered.length === 0 ? null : (
        <p className="text-[12px] text-text-secondary">
          Requirements no design of {loop.set === "" ? "the set" : `“${loop.set}”`} refers to yet:{" "}
          {loop.coverage.uncovered.map((id) => (
            <code key={id} className="mr-1 rounded bg-hover px-1 py-0.5 text-[11px] text-text">
              {id}
            </code>
          ))}
        </p>
      )}
    </section>
  );
}

function LoopTiles({ loop }: { loop: DesignLoop }): React.JSX.Element {
  const clusters = loop.clusters.length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Rounds" value={String(loop.round)} hint={clusters === 0 ? "No units share interfaces" : `${clusters} cluster${clusters === 1 ? "" : "s"} read together`} />
      <StatTile label="Open" value={String(loop.open)} tone={loop.open === 0 ? "green" : "orange"} hint="Blockers, majors, failing checks" />
      <StatTile label="Fixed" value={String(loop.resolvedTotal)} hint="Reported, fixed and checked again" />
      <StatTile
        label="Requirements"
        value={loop.coverage === undefined ? "—" : `${loop.coverage.covered}/${loop.coverage.total}`}
        hint={loop.coverage === undefined ? "Not checked" : "Referred to by a design of the set"}
      />
    </div>
  );
}

/** One line per round with a bar for its open count, scaled to the first round. */
function LoopRounds({ loop }: { loop: DesignLoop }): React.JSX.Element | null {
  if (loop.rounds.length === 0) return null;
  const most = Math.max(1, ...loop.rounds.map((entry) => entry.open));
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Rounds">
      {loop.rounds.map((entry) => (
        <li key={entry.round} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-[12px] text-text-secondary">
          <span className="text-text">Round {entry.round}</span>
          <span className="h-2 overflow-hidden rounded-full bg-hover" role="img" aria-label={`${entry.open} open`}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(entry.open === 0 ? 0 : 4, (entry.open / most) * 100)}%`, backgroundColor: entry.open === 0 ? "var(--ds-status-green)" : "var(--ds-status-orange)" }} />
          </span>
          <span className="tabular-nums">
            {entry.open} open{entry.fixed === 0 ? "" : ` · ${entry.fixed} unit${entry.fixed === 1 ? "" : "s"} fixed`}
            {entry.resolved === 0 ? "" : ` · ${entry.resolved} resolved`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function UnitFindings({ unit }: { unit: LoopUnit }): React.JSX.Element {
  const counts = findingCounts(unit);
  return (
    <li className="rounded-lg bg-recessed/40">
      <details open={counts.open > 0}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          <StatusDot tone={STATE_TONE[unit.state] ?? "muted"} className="size-2" />
          <span className="min-w-0 break-all font-mono text-[12px] text-text">{unit.unit}</span>
          <span className="text-text-secondary">{STATE_LABEL[unit.state] ?? unit.state}</span>
          <span className="ml-auto text-[12px] text-text-secondary tabular-nums">
            {unit.reviewed ? `${counts.open} open · ${counts.fixed} fixed` : "Not reviewed"}
          </span>
        </summary>
        {unit.findings.length === 0 ? (
          <p className="px-3 pb-3 text-[12px] text-text-secondary">{unit.reviewed ? "No finding in any round." : "No usable review note."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06] px-3 pb-2 dark:divide-white/[0.08]" aria-label={`Findings of ${unit.unit}`}>
            {unit.findings.map((finding) => (
              <FindingRow key={`${finding.id}:${finding.status}`} finding={finding} />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

function FindingRow({ finding }: { finding: LoopFinding }): React.JSX.Element {
  const where = [finding.document, finding.section === "" || finding.section === "-" ? "" : finding.section].filter((part) => part !== "").join(" › ");
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <StatusDot tone={SEVERITY_TONE[finding.severity]} className="size-2" />
        <span className="font-medium text-text">{finding.severity}</span>
        <Badge className={finding.status === "fixed" ? "line-through decoration-text-muted" : undefined}>{finding.status === "fixed" ? "Fixed" : "Open"}</Badge>
        <span className="text-text-secondary">{finding.category}</span>
        {finding.source === "contract" ? <Badge>between units</Badge> : null}
        <span className="min-w-0 break-all text-text-muted">{where}</span>
        <span className="ml-auto text-text-muted tabular-nums">{roundsOf(finding)}</span>
      </div>
      <p className={finding.status === "fixed" ? "text-[13px] text-text-secondary" : "text-[13px] text-text"}>{finding.finding}</p>
      {finding.suggestion === "" ? null : <p className="text-[12px] text-text-secondary">Suggestion: {finding.suggestion}</p>}
    </li>
  );
}
