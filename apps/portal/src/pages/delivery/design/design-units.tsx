// Design → Units: the working table. One row per unit with where its design stands, one column per
// design set of the project (so a project with more sets gets more columns), filtered by set and
// state, module and kind. A row opens the unit's drawer.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { DesignOverview, UnitDesignRow } from "@/lib/api/design";
import { CountChip } from "../results/results-parts";
import { ConformanceMark } from "./design-parts";
import { matchesFilters, STATE_LABEL, STATE_ORDER, STATE_TONE, stateOf, type UnitFilters } from "./design-state";

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
  filters,
  onFilters,
  selected,
  onOpen,
  understandLink,
}: {
  overview: DesignOverview;
  filters: UnitFilters;
  onFilters: (patch: Partial<UnitFilters>) => void;
  selected: string | undefined;
  onOpen: (key: string) => void;
  /** Where the understand stage of this application is, for the empty state. */
  understandLink: string;
}): React.JSX.Element {
  const { units, sets } = overview;
  if (sets.length === 0) {
    return (
      <Card>
        <EmptyState title="No design sets yet" description="The units' designs are listed once the project defines its design sets in standards/design/ of the document repo." />
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
  const columns: Column<UnitDesignRow>[] = [
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
    ...sets.map(
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
  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
