// Design → Units: the working table. One row per unit with where its design stands, one column per
// design set of the project (so a project with more sets gets more columns), filtered by set and
// state, module and kind. A row opens the unit's drawer. With a set chosen in the filter, units the set
// can be generated for get a checkbox and a bar at the bottom starts the run (ADR-0049).

import { Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { ConformanceMark } from "./design-parts";
import { APPLICATION_UNIT_KEY } from "@kintsugi/domain";
import type { DesignConflict, DesignOverview, DesignSet, UnitDesignRow, UnitSetActivity } from "@/lib/api/design";
import { applicationEligibility, eligibility, generateBlocker, MAX_UNITS_PER_RUN, selectable, setFacts, stillSelectable } from "@/lib/design-run";
import { CountChip } from "../results/results-parts";
import type { RequestGenerate } from "./design-stage";
import { matchesFilters, STATE_LABEL, STATE_ORDER, STATE_TONE, stateOf, type UnitFilters } from "./design-state";

const CONFLICT_LABEL: Record<DesignConflict["state"], string> = {
  running: "is being generated",
  "in-pr": "is in an open pull request",
  written: "has this set already",
  needs: "lacks a set it needs",
};

function SetCell({ row, set }: { row: UnitDesignRow; set: string }): React.JSX.Element {
  const summary = row.sets[set];
  if (summary === undefined) return <ConformanceMark state="not-applicable" />;
  const { files } = summary;
  const detail = files.total > 1 ? `${files.conformant + files.waived}/${files.total}` : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <ConformanceMark state={summary.state} detail={detail} label={summary.state === "problems" ? `${files.problems} with problems` : undefined} />
      {summary.state !== "stale" && files.stale > 0 ? <span className="text-[11px] text-[var(--ds-status-orange)]">stale</span> : null}
      {summary.ready ? <span className="rounded-[var(--geist-pill-radius)] bg-hover px-1.5 text-[11px] text-text-secondary">next</span> : null}
    </span>
  );
}

export function DesignUnitsTab({
  overview,
  activity,
  runDisabled,
  conflicts,
  onGenerate,
  setDetails,
  filters,
  onFilters,
  selected,
  onOpen,
  understandLink,
}: {
  overview: DesignOverview;
  /** The units a run is generating or a pull request carries, per set. */
  activity: readonly UnitSetActivity[];
  /** Why no run can start (permission, repositories); undefined when one can. */
  runDisabled: string | undefined;
  /** What the API refused in the last request. */
  conflicts: readonly DesignConflict[];
  onGenerate: RequestGenerate;
  /** The sets with their files and what they need and read, for what the picker says about the chosen one. */
  setDetails: readonly DesignSet[] | undefined;
  filters: UnitFilters;
  onFilters: (patch: Partial<UnitFilters>) => void;
  selected: string | undefined;
  onOpen: (key: string) => void;
  /** Where the understand stage of this application is, for the empty state. */
  understandLink: string;
}): React.JSX.Element {
  const { units, sets } = overview;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  if (sets.length === 0) {
    return (
      <Card>
        <EmptyState title="No design sets yet" description="The units' designs are listed once the project defines its design sets in 01-standards/templates/ of the document repo." />
      </Card>
    );
  }
  if (units.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No unit has a unit file yet"
          description="A unit exists once it is understood. Run understand on catalog items first; their designs are tracked here."
          action={
            <Link to={understandLink} className="text-[13px] text-accent hover:underline">
              Open the understand stage
            </Link>
          }
        />
      </Card>
    );
  }
  const modules = [...new Set(units.map((unit) => unit.module))].sort();
  const kinds = [...new Set(units.map((unit) => unit.kind))].sort();
  const rows = units.filter((unit) => matchesFilters(unit, filters));
  const chosenSet = sets.find((set) => set.id === filters.set);
  // Units picked before a refresh that cannot be generated now drop out of the selection.
  const chosen = stillSelectable(picked, units, chosenSet, activity);
  const ready = selectable(rows, chosenSet, activity);
  const blocker = generateBlocker({ set: filters.set, count: chosen.length, disabled: runDisabled });
  const toggle = (key: string, on: boolean): void =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const columns: Column<UnitDesignRow>[] = [
    ...(chosenSet === undefined
      ? []
      : [
          {
            id: "pick",
            header: "",
            className: "w-8",
            cell: (row: UnitDesignRow) => {
              const result = eligibility(row, chosenSet, activity);
              return (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.key}`}
                  disabled={!result.ok}
                  title={result.ok ? undefined : result.reason}
                  checked={chosen.includes(row.key)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => toggle(row.key, event.target.checked)}
                  className="size-3.5 accent-[var(--ds-text)] disabled:opacity-40"
                />
              );
            },
          } satisfies Column<UnitDesignRow>,
        ]),
    {
      id: "unit",
      header: "Unit",
      sort: (row) => row.key,
      search: (row) => `${row.key} ${row.title ?? ""}`,
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-text">{row.key}</span>
          {row.title === undefined || row.title === row.unit ? null : <span className="truncate text-[11.5px] text-text-muted">{row.title}</span>}
        </span>
      ),
    },
    { id: "kind", header: "Kind", sort: (row) => row.kind, cell: (row) => <span className="text-text-secondary">{row.kind}</span> },
    { id: "wave", header: "Wave", sort: (row) => (row.wave === undefined ? undefined : Number(row.wave)), search: (row) => row.wave ?? "", cell: (row) => <span className="text-text-secondary">{row.wave ?? "—"}</span> },
    { id: "owner", header: "Owner", sort: (row) => row.owner, search: (row) => row.owner ?? "", cell: (row) => <span className="text-text-secondary">{row.owner ?? "—"}</span> },
    ...sets.filter((set) => set.scope === "unit").map(
      (set): Column<UnitDesignRow> => ({
        id: `set:${set.id}`,
        header: set.title,
        title: `${set.id}@${set.version}`,
        sort: (row) => STATE_ORDER.indexOf(stateOf(row, set.id)) + (row.sets[set.id] === undefined ? 100 : 0),
        cell: (row) => <SetCell row={row} set={set.id} />,
      }),
    ),
    {
      id: "rules",
      header: "Rules",
      align: "right",
      sort: (row) => row.rules.total,
      cell: (row) =>
        row.rules.total === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span title={row.rules.uncovered === null ? "No written design lists the rules yet" : `${row.rules.uncovered} not named by a written design`} className="text-text-secondary">
            {row.rules.uncovered === null ? row.rules.total : `${row.rules.total - row.rules.uncovered}/${row.rules.total}`}
          </span>
        ),
    },
  ];
  const setOptions = [{ value: "", label: "Any set" }, ...sets.map((set) => ({ value: set.id, label: set.title }))];
  const here = filters.set === "" ? undefined : overview.counts[filters.set];
  const details = chosenSet === undefined ? undefined : setDetails?.find((entry) => entry.id === chosenSet.id);
  const facts = details === undefined ? null : <SetFactsPanel set={details} />;
  if (chosenSet?.scope === "application") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.set} onChange={(set) => onFilters({ set })} options={setOptions} />
          <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => onFilters({ set: "", state: "", module: "", kind: "" })}>
            Clear filters
          </button>
        </div>
        {facts}
        <ApplicationDesignCard overview={overview} set={chosenSet} activity={activity} runDisabled={runDisabled} conflicts={conflicts} onGenerate={onGenerate} onOpen={onOpen} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {facts}
      <div className="flex flex-wrap items-center gap-1.5">
        <CountChip label="All" count={units.length} active={filters.state === ""} onClick={() => onFilters({ state: "" })} />
        {STATE_ORDER.map((state) => {
          const count = here !== undefined ? (here[state] ?? 0) : units.filter((unit) => Object.values(unit.sets).some((summary) => summary.state === state)).length;
          return count === 0 && filters.state !== state ? null : <CountChip key={state} label={STATE_LABEL[state]} count={count} tone={STATE_TONE[state]} active={filters.state === state} onClick={() => onFilters({ state: filters.state === state ? "" : state })} />;
        })}
      </div>
      <DataTable
        label="Units and their design"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        searchPlaceholder="Search units"
        initialSort={{ id: "wave" }}
        onRowClick={(row) => onOpen(row.key)}
        selectedKey={selected}
        minWidth={820}
        pageSize={50}
        toolbar={
          <>
            <Select value={filters.set} onChange={(set) => onFilters({ set })} options={setOptions} />
            <Select value={filters.module} onChange={(module) => onFilters({ module })} options={[{ value: "", label: "Any module" }, ...modules.map((value) => ({ value, label: value }))]} />
            <Select value={filters.kind} onChange={(kind) => onFilters({ kind })} options={[{ value: "", label: "Any kind" }, ...kinds.map((value) => ({ value, label: value }))]} />
            {filters.set === "" && filters.state === "" && filters.module === "" && filters.kind === "" ? null : (
              <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => onFilters({ set: "", state: "", module: "", kind: "" })}>
                Clear filters
              </button>
            )}
          </>
        }
        empty="No unit matches these filters."
      />
      {chosenSet === undefined ? (
        <p className="text-[12px] text-text-muted">Choose a design set in the filter above to select the units to generate it for. A design that exists is never overwritten.</p>
      ) : (
        <div className="sticky bottom-3 z-10">
          <Card className="py-3 shadow-[var(--ds-shadow-menu,0_4px_16px_rgba(0,0,0,0.12))]">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-text tabular-nums">
                <span className="font-medium">
                  {chosen.length} unit{chosen.length === 1 ? "" : "s"}
                </span>
                <span className="text-text-muted">
                  {" "}
                  of {ready.length} ready for {chosenSet.title}
                </span>
              </p>
              <Button size="small" variant="ghost" className="shadow-border" disabled={ready.length === 0} onClick={() => setPicked(new Set(ready.slice(0, MAX_UNITS_PER_RUN)))} title={`Selects up to ${MAX_UNITS_PER_RUN} units, the ones a run takes`}>
                Select ready
              </Button>
              {chosen.length === 0 ? null : (
                <Button size="small" variant="ghost" onClick={() => setPicked(new Set())}>
                  Clear selection
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {blocker === undefined ? null : <span className="max-w-sm text-right text-[11px] text-text-muted">{blocker}</span>}
                <Button size="small" variant="solid" disabled={blocker !== undefined} onClick={() => onGenerate(chosenSet.id, chosen)}>
                  <Play className="size-3.5" />
                  Generate {chosenSet.title.toLowerCase()}
                </Button>
              </div>
            </div>
            {conflicts.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-text-secondary">
                {conflicts.map((conflict) => (
                  <li key={conflict.unit}>
                    <span className="font-mono">{conflict.unit}</span> {CONFLICT_LABEL[conflict.state]}
                    {conflict.runId === undefined ? "" : ` (run ${conflict.runId.slice(0, 8)})`}
                    {conflict.needs === undefined || conflict.needs.length === 0 ? "" : `: ${conflict.needs.join(", ")}`}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/** What a person reads about the chosen set before generating it (ADR-0050): who it is for, what it writes, what it needs and reads. */
function SetFactsPanel({ set }: { set: DesignSet }): React.JSX.Element {
  return (
    <Card className="px-4 py-3">
      <p className="text-[13px] font-medium text-text">
        {set.title} <span className="font-mono text-[11.5px] font-normal text-text-muted">{set.id}@{set.version}</span>
      </p>
      {set.description === "" ? null : <p className="mt-0.5 text-[12.5px] text-text-secondary">{set.description}</p>}
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-[12px]">
        {setFacts(set).map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-text-muted">{fact.label}</dt>
            <dd className="min-w-0 break-words text-text-secondary">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** A set of the application: one design for the whole application, with its state and the button that generates it. */
function ApplicationDesignCard({
  overview,
  set,
  activity,
  runDisabled,
  conflicts,
  onGenerate,
  onOpen,
}: {
  overview: DesignOverview;
  set: DesignOverview["sets"][number];
  activity: readonly UnitSetActivity[];
  runDisabled: string | undefined;
  conflicts: readonly DesignConflict[];
  onGenerate: RequestGenerate;
  onOpen: (key: string) => void;
}): React.JSX.Element {
  const summary = overview.application.sets[set.id];
  const result = applicationEligibility(overview, set, activity);
  const blocker = result.ok ? runDisabled : result.reason;
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">Application design</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-text-secondary">
            {summary === undefined ? null : <ConformanceMark state={summary.state} detail={summary.files.total > 1 ? `${summary.files.conformant + summary.files.waived}/${summary.files.total}` : undefined} />}
            <button type="button" className="text-accent hover:underline" onClick={() => onOpen(APPLICATION_UNIT_KEY)}>
              Open the documents
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {blocker === undefined ? null : <span className="max-w-sm text-right text-[11px] text-text-muted">{blocker}</span>}
          <Button size="small" variant="solid" disabled={blocker !== undefined} onClick={() => onGenerate(set.id, [APPLICATION_UNIT_KEY])}>
            <Play className="size-3.5" />
            Generate {set.title.toLowerCase()}
          </Button>
        </div>
      </div>
      {conflicts.length === 0 ? null : (
        <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-text-secondary">
          {conflicts.map((conflict) => (
            <li key={conflict.unit}>
              the application {CONFLICT_LABEL[conflict.state]}
              {conflict.needs === undefined || conflict.needs.length === 0 ? "" : `: ${conflict.needs.join(", ")}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
