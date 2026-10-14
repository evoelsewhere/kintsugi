// Results of understand (ADR-0031): KPIs, the units with a detail drawer that renders the unit's
// AS-IS specification (loaded from the document repo at the results' commit, Mermaid fences drawn),
// the traceability matrix (unit × rules and findings, what no unit covers, the "left out" counts),
// the dependency graph between modules and units as Mermaid flowcharts, and the synthesis
// documents (overview, architecture, data model, integrations) rendered.

import { AlertTriangle, CheckCircle2, DoorOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Loaded } from "@/components/loaded";
import { InlineText } from "@/components/results/inline-text";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { Markdown } from "@/components/results/lazy-markdown";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";
import { StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { StatusTone } from "@/components/ui/status-dot";
import { type AsIsDocument, documentsApi, type UnderstandResults, type UnderstandUnit } from "@/lib/api/documents";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { domainColors, formatCount } from "./results-format";
import { CountChip, Field, Kpi, KpiRow, Section, SubTabs } from "./results-parts";
import { UnderstandOverview } from "./understand-overview";
import { moduleFlowchart, unitFlowchart } from "./units-mermaid";

type Tab = "overview" | "units" | "matrix" | "graph" | AsIsDocument["id"];

const WORK_ITEM_TONE: Record<string, StatusTone> = {
  pending: "muted",
  "in-progress": "blue",
  "awaiting-review": "orange",
  approved: "green",
  done: "green",
  rejected: "red",
  blocked: "red",
  skipped: "muted",
  proposed: "purple-light",
};

/** Where a work item's status was read, for the badge's tooltip and the drawer. */
const statusSourceOf = (workItem: NonNullable<UnderstandUnit["workItem"]>): string | undefined =>
  workItem.statusFrom === "default-branch"
    ? "Status from the default branch"
    : workItem.statusFrom === "ref"
      ? "Not on the default branch yet: proposed in the run's pull request"
      : undefined;

const DOCUMENT_HINT: Record<AsIsDocument["id"], string> = {
  readme: "the index of modules and units, and the inputs that were missing",
  architecture: "modules, how they interact, entry points and the dependency cycles",
  "data-model": "data stores and data objects, which units read and write them",
  integrations: "external systems and interfaces, their direction and format",
};

export function UnderstandResultsView({ results, compare, projectId }: { results: UnderstandResults; compare: boolean; projectId: string }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const previous = compare ? results.previous?.counts : undefined;
  const counts = results.counts;
  const modules = useMemo(() => [...new Set(results.units.map((unit) => unit.module))].sort(), [results.units]);
  const colors = useMemo(() => domainColors(modules), [modules]);
  const byId = useMemo(() => new Map(results.units.map((unit) => [unit.id, unit])), [results.units]);
  const opened = detail === undefined ? undefined : byId.get(detail);
  // A link to a unit's AS-IS spec or work item opens the unit's drawer in place.
  useDocumentLinkHandler((target) => {
    const unit = results.units.find((entry) => entry.spec === target.path || entry.workItem?.path === target.path);
    if (unit === undefined) return false;
    setDetail(unit.id);
    return true;
  });
  const documentOf = (id: AsIsDocument["id"]): AsIsDocument | undefined => results.documents.find((document) => document.id === id);

  return (
    <div className="flex flex-col gap-4">
      <InputNotes results={results} />
      <KpiRow>
        <Kpi label="Units" value={counts["units"]} previous={previous?.["units"]} hint={`${formatCount(counts["specified"])} with a specification`} />
        <Kpi label="Modules" value={counts["modules"]} previous={previous?.["modules"]} hint={`${formatCount(counts["entryPoints"])} units hold an entry point`} />
        <Kpi
          label="Rules covered"
          value={counts["rulesCovered"]}
          previous={previous?.["rulesCovered"]}
          hint={results.matrix?.inputs.businessRules === false ? "No BUSINESS_RULES.md: run extract-rules" : `${formatCount(counts["rulesUncovered"])} not applied by any unit`}
          {...((counts["rulesUncovered"] ?? 0) > 0 ? { tone: "orange" as const } : {})}
        />
        <Kpi
          label="Findings mapped"
          value={counts["findingsMapped"]}
          previous={previous?.["findingsMapped"]}
          hint={results.matrix?.inputs.securityFindings === false ? "No SECURITY_FINDINGS.md: run harden" : `${formatCount(counts["findingsUnmapped"])} carried by no unit`}
          {...((counts["findingsUnmapped"] ?? 0) > 0 ? { tone: "orange" as const } : {})}
        />
        <Kpi label="Files covered" value={counts["files"]} previous={previous?.["files"]} hint="Source files cited by a unit" />
        <Kpi
          label="Work items"
          value={counts["workItems"]}
          previous={previous?.["workItems"]}
          hint={(counts["workItems"] ?? 0) < (counts["units"] ?? 0) ? `${formatCount((counts["units"] ?? 0) - (counts["workItems"] ?? 0))} without one at this ref` : "One per unit"}
        />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "units", label: "Units", count: results.units.length },
          { id: "matrix", label: "Traceability", count: counts["leftOut"] === undefined || counts["leftOut"] === 0 ? undefined : counts["leftOut"] },
          { id: "graph", label: "Dependencies" },
          { id: "readme", label: "Overview", hidden: documentOf("readme") === undefined },
          { id: "architecture", label: "Architecture" },
          { id: "data-model", label: "Data model" },
          { id: "integrations", label: "Integrations" },
        ]}
      />

      {results.matrix === null && (tab === "units" || tab === "matrix" || tab === "graph") ? (
        <EmptyState title="No traceability.json at this ref" description="merge_traceability.py writes it after the specification jobs; pick another ref above or run understand again." />
      ) : null}
      {tab === "overview" ? <UnderstandOverview results={results} onOpen={setDetail} onMatrix={() => setTab("matrix")} /> : null}
      {tab === "units" && results.matrix !== null ? <UnitsTab units={results.units} modules={modules} onOpen={setDetail} /> : null}
      {tab === "matrix" && results.matrix !== null ? <MatrixTab results={results} modules={modules} onOpen={setDetail} /> : null}
      {tab === "graph" && results.matrix !== null ? <GraphTab units={results.units} modules={modules} colors={colors} onOpen={setDetail} /> : null}
      {tab === "readme" || tab === "architecture" || tab === "data-model" || tab === "integrations" ? <DocumentTab id={tab} document={documentOf(tab)} /> : null}

      <Drawer open={opened !== undefined} size="wide" title={opened?.title ?? ""} subtitle={opened?.id} onClose={() => setDetail(undefined)}>
        {opened === undefined ? null : <UnitDetail unit={opened} byId={byId} projectId={projectId} commit={results.ref.commit} onOpen={setDetail} />}
      </Drawer>
    </div>
  );
}

/** The optional inputs the run did not have, and what the matrix was merged without. */
function InputNotes({ results }: { results: UnderstandResults }): React.JSX.Element | null {
  const notes = results.missingInputs.map((input) => `${input.path} was not on the default branch when the run started: run ${input.stage} and merge its pull request, then run understand again.`);
  if (notes.length === 0 && results.matrix !== null) {
    if (!results.matrix.inputs.businessRules) notes.push("The matrix was merged without BUSINESS_RULES.md: no rule is mapped to a unit.");
    if (!results.matrix.inputs.securityFindings) notes.push("The matrix was merged without SECURITY_FINDINGS.md: no finding is mapped to a unit.");
  }
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-[var(--ds-status-orange)]/10 px-4 py-3 text-[12.5px] text-text-secondary">
      {notes.map((note) => (
        <p key={note} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
          <InlineText text={note} />
        </p>
      ))}
    </div>
  );
}

function WorkItemMark({ unit }: { unit: UnderstandUnit }): React.JSX.Element {
  if (unit.workItem === undefined) return <span className="text-text-muted">—</span>;
  const { status, path } = unit.workItem;
  const source = statusSourceOf(unit.workItem);
  return <StatusBadge tone={WORK_ITEM_TONE[status] ?? "muted"} label={status === "proposed" ? "proposed (in PR)" : status} title={source === undefined ? path : `${source} · ${path}`} />;
}

function UnitsTab({ units, modules, onOpen }: { units: UnderstandUnit[]; modules: string[]; onOpen: (id: string) => void }): React.JSX.Element {
  const [module, setModule] = useState("");
  const [only, setOnly] = useState<"" | "entry" | "unwritten">("");
  const rows = units.filter((unit) => (module === "" || unit.module === module) && (only === "" || (only === "entry" ? unit.entryPoint : unit.spec === null)));
  const columns: Column<UnderstandUnit>[] = [
    {
      id: "unit",
      header: "Unit",
      cell: (unit) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {unit.entryPoint ? <DoorOpen className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} aria-label="Entry point" /> : null}
          <span className="min-w-0">
            <span className="block truncate text-text">{unit.title}</span>
            <span className="block truncate font-mono text-[11px] text-text-muted">{unit.key}</span>
          </span>
        </span>
      ),
      sort: (unit) => unit.key,
      search: (unit) => `${unit.key} ${unit.title} ${unit.files.join(" ")}`,
    },
    { id: "module", header: "Module", cell: (unit) => unit.module, sort: (unit) => unit.module },
    { id: "kind", header: "Kind", cell: (unit) => unit.kind ?? "—", sort: (unit) => unit.kind ?? "" },
    { id: "loc", header: "Lines", align: "right", cell: (unit) => formatCount(unit.loc), sort: (unit) => unit.loc },
    {
      id: "spec",
      header: "Specification",
      cell: (unit) => (unit.spec === null ? <StatusBadge tone="orange" label="Not written" /> : <StatusBadge tone="green" label="Written" />),
      sort: (unit) => (unit.spec === null ? 1 : 0),
    },
    { id: "rules", header: "Rules", align: "right", cell: (unit) => unit.rules.length, sort: (unit) => unit.rules.length },
    { id: "findings", header: "Findings", align: "right", cell: (unit) => unit.findings.length, sort: (unit) => unit.findings.length },
    {
      id: "deps",
      header: "Deps in / out",
      title: "Units that depend on it / units it depends on",
      align: "right",
      cell: (unit) => (
        <span className="tabular-nums">
          {unit.usedBy.length} / {unit.dependsOn.length}
        </span>
      ),
      sort: (unit) => unit.usedBy.length + unit.dependsOn.length,
    },
    { id: "files", header: "Files", align: "right", cell: (unit) => unit.files.length, sort: (unit) => unit.files.length },
    { id: "work", header: "Work item", cell: (unit) => <WorkItemMark unit={unit} />, sort: (unit) => unit.workItem?.status ?? "~" },
  ];
  return (
    <Section title="Units" description="Proposed from the map; click a unit for its AS-IS specification. Boundaries are corrected in the pull request.">
      <DataTable
        label="Units"
        rows={rows}
        columns={columns}
        rowKey={(unit) => unit.id}
        onRowClick={(unit) => onOpen(unit.id)}
        searchPlaceholder="Search units and files"
        initialSort={{ id: "unit" }}
        minWidth={900}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[200px]">
              <Select value={module} options={[{ value: "", label: "All modules" }, ...modules.map((entry) => ({ value: entry, label: entry, hint: String(units.filter((unit) => unit.module === entry).length) }))]} onChange={setModule} />
            </div>
            <CountChip label="Entry points" count={units.filter((unit) => unit.entryPoint).length} active={only === "entry"} onClick={() => setOnly(only === "entry" ? "" : "entry")} />
            <CountChip label="Not written" count={units.filter((unit) => unit.spec === null).length} active={only === "unwritten"} onClick={() => setOnly(only === "unwritten" ? "" : "unwritten")} tone="orange" />
          </div>
        }
        empty={<p className="p-4 text-[12px] text-text-muted">No unit matches.</p>}
      />
    </Section>
  );
}

/** Columns of the unit × id grid at most; beyond it the ids are listed instead. */
const MAX_GRID_COLUMNS = 60;

function MatrixTab({ results, modules, onOpen }: { results: UnderstandResults; modules: string[]; onOpen: (id: string) => void }): React.JSX.Element {
  const matrix = results.matrix!;
  const [module, setModule] = useState("");
  const [kind, setKind] = useState<"rules" | "findings" | "files">("rules");
  const units = results.units.filter((unit) => module === "" || unit.module === module);
  const files = useMemo(() => [...new Set(results.units.flatMap((unit) => unit.files))].sort(), [results.units]);
  const ids = kind === "rules" ? matrix.rulesCovered : kind === "findings" ? matrix.findingsMapped : files;
  const unmapped = kind === "rules" ? matrix.unmappedRules : kind === "findings" ? matrix.unmappedFindings : [];
  const valuesOf = (unit: UnderstandUnit): string[] => (kind === "rules" ? unit.rules : kind === "findings" ? unit.findings : unit.files);
  const noun = kind === "rules" ? "business rule" : kind === "findings" ? "security finding" : "source file";
  const leftOut = Object.entries(matrix.notes);
  const columns = [...ids, ...unmapped].slice(0, MAX_GRID_COLUMNS);
  const unmappedSet = new Set(unmapped);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="Left out" description="Values the merge script could not check and dropped: review them in the pull request.">
          {leftOut.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-text-secondary">
              <CheckCircle2 className="size-4 text-[var(--ds-status-green)]" strokeWidth={1.75} />
              Nothing was left out.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {leftOut.map(([reason, value]) => (
                <li key={reason} className="flex items-center justify-between gap-3 rounded-md bg-[var(--ds-status-orange)]/10 px-2.5 py-1">
                  <span className="text-text-secondary">{reason}</span>
                  <span className="font-semibold text-text tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Not covered" description="Catalogued ids no unit applies or carries.">
          <div className="flex flex-col gap-3">
            <Field label={`Rules (${matrix.unmappedRules.length})`}>{matrix.unmappedRules.length === 0 ? "Every catalogued rule is applied by a unit." : <IdList ids={matrix.unmappedRules} tone="orange" />}</Field>
            <Field label={`Findings (${matrix.unmappedFindings.length})`}>{matrix.unmappedFindings.length === 0 ? "Every finding is located in a unit." : <IdList ids={matrix.unmappedFindings} tone="orange" />}</Field>
          </div>
        </Section>
        <Section title="Dependency cycles" description="Units that depend on each other, directly or through others.">
          {matrix.cycles.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No cycle.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {matrix.cycles.map((cycle) => (
                <li key={cycle.join(",")} className="font-mono text-text-secondary">
                  {cycle.join(" ↔ ")}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section
        title="Unit × id"
        description={`Which unit ${kind === "files" ? "cites" : kind === "rules" ? "applies" : "carries"} each ${noun}${kind === "files" ? "" : "; highlighted columns are covered by no unit"}.`}
        actions={
          <div className="flex items-center gap-2">
            <CountChip label="Rules" count={matrix.rulesCovered.length} active={kind === "rules"} onClick={() => setKind("rules")} />
            <CountChip label="Findings" count={matrix.findingsMapped.length} active={kind === "findings"} onClick={() => setKind("findings")} />
            <CountChip label="Files" count={files.length} active={kind === "files"} onClick={() => setKind("files")} />
            <div className="w-[180px]">
              <Select value={module} options={[{ value: "", label: "All modules" }, ...modules.map((entry) => ({ value: entry, label: entry }))]} onChange={setModule} />
            </div>
          </div>
        }
      >
        {columns.length === 0 ? (
          <p className="text-[12px] text-text-muted">No {noun} is mapped to a unit.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ids.length + unmapped.length > MAX_GRID_COLUMNS ? <p className="text-[12px] text-text-muted">Showing the first {MAX_GRID_COLUMNS} of {ids.length + unmapped.length} ids; each unit's drawer lists all of its ids.</p> : null}
            <div className="max-h-[560px] overflow-auto rounded-lg shadow-border">
              <table className="text-[12px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className="sticky left-0 z-20 bg-surface px-3 py-1.5 text-left text-[11px] font-normal tracking-wide text-text-muted uppercase">Unit</th>
                    {columns.map((id) => (
                      <th key={id} className={cn("h-24 px-1 align-bottom font-mono text-[10.5px] font-normal", unmappedSet.has(id) ? "bg-[var(--ds-status-orange)]/15 text-text" : "text-text-muted")} title={unmappedSet.has(id) ? `${id}: covered by no unit` : id}>
                        <span className="inline-block max-h-40 truncate [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{kind === "files" ? (id.split("/").pop() ?? id) : id}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => {
                    const has = new Set(valuesOf(unit));
                    return (
                      <tr key={unit.id} className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] hover:bg-hover">
                        <td className="sticky left-0 bg-surface px-3 py-1">
                          <button type="button" className="max-w-[240px] truncate text-left font-mono text-[11.5px] text-text hover:underline" onClick={() => onOpen(unit.id)}>
                            {unit.key}
                          </button>
                        </td>
                        {columns.map((id) => (
                          <td key={id} className={cn("px-1 text-center", unmappedSet.has(id) && "bg-[var(--ds-status-orange)]/10")}>
                            {has.has(id) ? <span className="inline-block size-2.5 rounded-full bg-[var(--ds-status-blue)]" aria-label={`${unit.key} → ${id}`} /> : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function IdList({ ids, tone }: { ids: string[]; tone?: "orange" }): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <code key={id} className={cn("rounded-[4px] px-1.5 py-px font-mono text-[11px]", tone === "orange" ? "bg-[var(--ds-status-orange)]/15 text-text" : "bg-hover text-text-secondary")}>
          {id}
        </code>
      ))}
    </span>
  );
}

function GraphTab({ units, modules, colors, onOpen }: { units: UnderstandUnit[]; modules: string[]; colors: Map<string, string>; onOpen: (id: string) => void }): React.JSX.Element {
  const [level, setLevel] = useState<"modules" | "units">("modules");
  const [module, setModule] = useState("");
  const chart = useMemo(
    () => (level === "modules" ? moduleFlowchart(units, modules, colors) : unitFlowchart(units, modules, colors, module === "" ? {} : { module })),
    [level, module, units, modules, colors],
  );
  const click = (id: string): void => {
    const target = chart.ids.get(id);
    if (target === undefined) return;
    if (level === "modules") {
      setModule(target);
      setLevel("units");
    } else onOpen(target);
  };
  return (
    <Section
      title="Dependencies"
      description={
        level === "modules"
          ? "Modules and how many unit dependencies run between them; click a module for its units."
          : "Units grouped by module, with the units they depend on or are used by; click a unit for its specification. Thick outline: entry point; dashed: no specification."
      }
      actions={
        <div className="flex items-center gap-2">
          <CountChip label="Modules" count={modules.length} active={level === "modules"} onClick={() => setLevel("modules")} />
          <CountChip label="Units" count={units.length} active={level === "units"} onClick={() => setLevel("units")} />
          {level === "units" ? (
            <div className="w-[200px]">
              <Select value={module} options={[{ value: "", label: "All modules" }, ...modules.map((entry) => ({ value: entry, label: entry }))]} onChange={setModule} />
            </div>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {chart.shown < chart.matching ? (
          <p className="text-[12px] text-text-secondary">
            Showing the {chart.shown} largest of {formatCount(chart.matching)} units: pick a module to see the rest.
          </p>
        ) : null}
        {chart.shown === 0 ? (
          <p className="rounded-lg bg-recessed/60 p-4 text-[12px] text-text-muted">No unit to draw.</p>
        ) : (
          <MermaidDiagram key={`${level}/${module}`} source={chart.source} title={`${chart.shown} ${level === "modules" ? "modules" : "units"} · ${chart.edges} ${chart.edges === 1 ? "edge" : "edges"}`} height={640} onNodeClick={click} />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-text-secondary">
          <span className="text-[11px] tracking-wide text-text-muted uppercase">Modules</span>
          {modules.map((entry) => (
            <span key={entry} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: colors.get(entry) }} />
              {entry}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function DocumentTab({ id, document }: { id: AsIsDocument["id"]; document: AsIsDocument | undefined }): React.JSX.Element {
  if (document === undefined) {
    return <EmptyState title="Not written at this ref" description={`The synthesis job writes ${id === "readme" ? "README.md" : `${id}.md`} (${DOCUMENT_HINT[id]}) after the traceability matrix.`} />;
  }
  return (
    <Section title={document.title} description={document.path}>
      <Markdown text={document.markdown} path={document.path} />
    </Section>
  );
}

function UnitLinks({ ids, byId, onOpen }: { ids: string[]; byId: Map<string, UnderstandUnit>; onOpen: (id: string) => void }): React.JSX.Element | null {
  if (ids.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const unit = byId.get(id);
        return unit === undefined ? (
          <code key={id} className="rounded-[4px] bg-hover px-1.5 py-px font-mono text-[11px]">
            {id}
          </code>
        ) : (
          <Button key={id} size="small" variant="ghost" className="h-6 px-2 font-mono text-[11px] shadow-border" onClick={() => onOpen(id)}>
            {unit.key}
          </Button>
        );
      })}
    </span>
  );
}

function UnitDetail({ unit, byId, projectId, commit, onOpen }: { unit: UnderstandUnit; byId: Map<string, UnderstandUnit>; projectId: string; commit: string; onOpen: (id: string) => void }): React.JSX.Element {
  const list = (values: string[]): React.ReactNode => (values.length === 0 ? null : <IdList ids={values} />);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={unit.spec === null ? "orange" : "green"} label={unit.spec === null ? "No specification" : "Specification written"} />
        {unit.entryPoint ? <StatusBadge tone="blue" label="Entry point" /> : null}
        {unit.kind === undefined ? null : <StatusBadge tone="muted" label={unit.kind} />}
        <span className="text-[12px] text-text-muted">{formatCount(unit.loc)} lines · {unit.openQuestions} open {unit.openQuestions === 1 ? "question" : "questions"}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Work item">{unit.workItem === undefined ? "None at this ref." : <span className="flex flex-wrap items-center gap-2"><WorkItemMark unit={unit} /><code className="font-mono text-[11px]">{unit.workItem.path}</code>{unit.workItem.complexity === undefined ? null : <span>complexity {unit.workItem.complexity}</span>}{statusSourceOf(unit.workItem) === undefined ? null : <span className="text-text-muted">{statusSourceOf(unit.workItem)}</span>}</span>}</Field>
        <Field label="Entry points">{list(unit.entryPoints)}</Field>
        <Field label="Depends on">
          <UnitLinks ids={unit.dependsOn} byId={byId} onOpen={onOpen} />
        </Field>
        <Field label="Used by">
          <UnitLinks ids={unit.usedBy} byId={byId} onOpen={onOpen} />
        </Field>
        <Field label="Data stores">{list(unit.dataStores.map((store) => `${store.id} (${store.access.join("/") || "?"})`))}</Field>
        <Field label="External systems">{list(unit.externalSystems)}</Field>
        <Field label="Business rules">{list(unit.rules)}</Field>
        <Field label="Security findings">{list(unit.findings)}</Field>
        <Field label="Data objects">{list(unit.dataObjects)}</Field>
        <Field label={`Files (${unit.files.length})`}>{list(unit.files)}</Field>
      </div>
      {unit.spec === null ? (
        <p className="rounded-lg bg-recessed/60 p-3 text-[12px] text-text-muted">No AS-IS specification was written for this unit in this run (budget or a failed job): a second run of understand specifies it.</p>
      ) : (
        <SpecDocument projectId={projectId} commit={commit} path={unit.spec} />
      )}
    </div>
  );
}

function SpecDocument({ projectId, commit, path }: { projectId: string; commit: string; path: string }): React.JSX.Element {
  const file = useLoader(`spec/${projectId}/${commit}/${path}`, () => documentsApi.file(projectId, path, commit));
  return (
    <section className="flex flex-col gap-2 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)] pt-3">
      <p className="font-mono text-[11px] text-text-muted">{path}</p>
      <Loaded loader={file} rows={8}>
        {(loaded) => <Markdown text={loaded.content} path={path} />}
      </Loaded>
    </section>
  );
}
