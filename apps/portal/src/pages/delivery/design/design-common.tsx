// Design → Common: the common components the foundation team designed (02-architecture/common/) and
// the units whose designs name each one, with the ids designs name that no document defines.
// Also Design → Coverage: for each unit, how many of its rules a written design names.

import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { CommonComponent, CommonDesign, DesignOverview, UnitDesignRow } from "@/lib/api/design";
import { CountChip, Section } from "../results/results-parts";
import { ConformanceMark } from "./design-parts";

export function DesignCommonTab({ common, onOpenUnit }: { common: CommonDesign; onOpenUnit: (key: string) => void }): React.JSX.Element {
  const columns: Column<CommonComponent>[] = [
    { id: "id", header: "Component", sort: (component) => component.id, search: (component) => `${component.id} ${component.title ?? ""}`, cell: (component) => <span className="flex flex-col"><span className="font-mono text-[12px] text-text">{component.id}</span>{component.title === undefined ? null : <span className="text-text-secondary">{component.title}</span>}</span> },
    { id: "status", header: "Status", sort: (component) => component.status, cell: (component) => <span className="text-text-secondary">{component.status ?? "—"}</span> },
    { id: "used", header: "Named by", align: "right", sort: (component) => component.referencedBy.length, cell: (component) => (component.referencedBy.length === 0 ? <span className="text-text-muted">no unit</span> : <span title={component.referencedBy.join(", ")}>{component.referencedBy.length} unit{component.referencedBy.length === 1 ? "" : "s"}</span>) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {common.components.length === 0 ? (
        <Card>
          <EmptyState title="No common components yet" description="The foundation team writes one document per component by hand in 02-architecture/common/ (COM-<AREA>-<NN>.md) and merges it through a pull request; no command writes them. Unit designs refer to a component by its id." />
        </Card>
      ) : (
        <DataTable label="Common components" rows={common.components} columns={columns} rowKey={(component) => component.id} searchPlaceholder="Search components" pageSize={25} minWidth={520} />
      )}
      {common.unresolved.length === 0 ? null : (
        <Section title="Named but not defined" description="Component ids that designs name and no document of 02-architecture/common/ defines. Define the component, or correct the design.">
          <ul className="flex flex-col gap-2 text-[13px]">
            {common.unresolved.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[12px] text-text">{entry.id}</span>
                <span className="flex flex-wrap gap-1.5">
                  {entry.referencedBy.map((key) => (
                    <button key={key} type="button" onClick={() => onOpenUnit(key)} className="rounded-[var(--geist-pill-radius)] px-2 py-0.5 text-[12px] text-text-secondary shadow-border hover:bg-hover hover:text-text">
                      {key}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

type CoverageFilter = "all" | "gaps" | "complete";

export function DesignCoverageTab({ overview, filter, onFilter, onOpenUnit }: { overview: DesignOverview; filter: CoverageFilter; onFilter: (filter: CoverageFilter) => void; onOpenUnit: (key: string) => void }): React.JSX.Element {
  const withRules = overview.units.filter((unit) => unit.rules.total > 0);
  const gaps = withRules.filter((unit) => unit.rules.uncovered === null || unit.rules.uncovered > 0);
  const rows = filter === "gaps" ? gaps : filter === "complete" ? withRules.filter((unit) => unit.rules.uncovered === 0) : withRules;
  if (withRules.length === 0) {
    return (
      <Card>
        <EmptyState title="No unit has rules yet" description="Rules come from the understanding of a unit. Coverage compares them with what the written designs name." />
      </Card>
    );
  }
  const columns: Column<UnitDesignRow>[] = [
    { id: "unit", header: "Unit", sort: (unit) => unit.key, search: (unit) => unit.key, cell: (unit) => <span className="text-text">{unit.key}</span> },
    { id: "rules", header: "Rules", align: "right", sort: (unit) => unit.rules.total, cell: (unit) => unit.rules.total },
    { id: "named", header: "Named by a design", align: "right", sort: (unit) => (unit.rules.uncovered === null ? undefined : unit.rules.total - unit.rules.uncovered), cell: (unit) => (unit.rules.uncovered === null ? <span className="text-text-muted">no design lists rules</span> : unit.rules.total - unit.rules.uncovered) },
    { id: "left", header: "Left out", align: "right", sort: (unit) => unit.rules.uncovered ?? undefined, cell: (unit) => (unit.rules.uncovered === null ? "—" : unit.rules.uncovered === 0 ? <ConformanceMark state="conformant" label="None" /> : <span className="text-text">{unit.rules.uncovered}</span>) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <CountChip label="All" count={withRules.length} active={filter === "all"} onClick={() => onFilter("all")} />
        <CountChip label="Has gaps" count={gaps.length} tone="orange" active={filter === "gaps"} onClick={() => onFilter("gaps")} />
        <CountChip label="Complete" count={withRules.length - gaps.length} tone="green" active={filter === "complete"} onClick={() => onFilter("complete")} />
      </div>
      <DataTable label="Rule coverage by unit" rows={rows} columns={columns} rowKey={(unit) => unit.key} searchPlaceholder="Search units" initialSort={{ id: "left", desc: true }} onRowClick={(unit) => onOpenUnit(unit.key)} pageSize={50} minWidth={560} empty="No unit matches." />
    </div>
  );
}
