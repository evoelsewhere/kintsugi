// The Data view of the understand results: the data of the legacy system in one place. Data objects (the records the
// rules read and write, with their fields), the data stores (tables, files, datasets) with the units that read and write
// them, the lineage between units and stores, and the model, an entity-relationship diagram of the objects. It joins what
// the rules, the topology and the traceability matrix already hold (lib/data-model.ts); nothing here is a result of its own.

import { Database } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { DetailPage } from "@/components/detail-page";
import { InlineText } from "@/components/results/inline-text";
import { Markdown } from "@/components/results/lazy-markdown";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { CatalogRule, MapResults, RulesResults, UnderstandResults, UnderstandUnit } from "@/lib/api/documents";
import { lineageDiagram, modelDiagram, objectUses, type ObjectUse, storeUses, type StoreUse } from "@/lib/data-model";
import { formatCount } from "./results-format";
import { Field, Kpi, KpiRow, Section, SubTabs } from "./results-parts";

type Tab = "overview" | "objects" | "stores" | "lineage" | "model" | "document";

export function DataResultsView({ rules, map, understand, onOpenItem }: { rules: RulesResults; map: MapResults; understand: UnderstandResults; onOpenItem?: ((item: string) => void) | undefined }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [open, setOpen] = useState<string | undefined>(undefined);
  const uses = useMemo(() => objectUses(rules.dataObjects, rules.rules, understand.units), [rules, understand.units]);
  const stores = useMemo(() => storeUses(map.topology?.nodes ?? [], understand.units, map.topology?.edges ?? []), [map.topology, understand.units]);
  const model = useMemo(() => modelDiagram(uses), [uses]);
  const lineage = useMemo(() => lineageDiagram(stores), [stores]);
  const document = understand.documents.find((entry) => entry.id === "data-model");
  const fields = rules.dataObjects.reduce((total, object) => total + object.fields.length, 0);
  const unused = uses.filter((use) => use.rules.length === 0 && use.units.length === 0).length;
  const opened = uses.find((use) => use.object.name === open);

  if (rules.dataObjects.length === 0 && stores.length === 0 && document === undefined) {
    return <EmptyState icon={Database} title="No data at this ref" description="extract-rules lists the core records in DATA_OBJECTS.md, the topology lists the data stores and understand records which units touch them." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Data objects" value={rules.dataObjects.length} hint={`${formatCount(fields)} fields`} />
        <Kpi label="Data stores" value={stores.length} hint="Tables, files and datasets" />
        <Kpi label="Written by units" value={stores.filter((store) => store.writers.length > 0).length} hint="Stores at least one unit writes" />
        <Kpi label="Not used" value={unused} hint="Objects no rule and no unit uses" {...(unused > 0 ? { tone: "orange" as const } : {})} higherIsWorse />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "objects", label: "Objects", count: uses.length },
          { id: "stores", label: "Stores", count: stores.length },
          { id: "lineage", label: "Lineage" },
          { id: "model", label: "Model" },
          { id: "document", label: "data-model.md", hidden: document === undefined },
        ]}
      />

      {tab === "overview" ? <Overview uses={uses} stores={stores} onObject={(name) => setOpen(name)} /> : null}
      {tab === "objects" ? <ObjectsTab uses={uses} onOpen={setOpen} /> : null}
      {tab === "stores" ? <StoresTab stores={stores} onOpenItem={onOpenItem} /> : null}
      {tab === "lineage" ? (
        <Section title="Lineage" description="Which units write each data store and which read it; the stores touched most are drawn.">
          {lineage === undefined ? (
            <EmptyState title="No unit touches a data store at this ref" description="Understand records the stores each unit reads and writes in its trace document; understand more items to draw the lineage." />
          ) : (
            <MermaidDiagram source={lineage} title="Data lineage" height={560} />
          )}
        </Section>
      ) : null}
      {tab === "lineage" ? <LeafLineage map={map} /> : null}
      {tab === "model" ? (
        <Section
          title="Model"
          description={model === undefined ? undefined : `${model.shown} objects with their fields; ${model.relations === 0 ? "no relation could be told" : `${model.relations} relation${model.relations === 1 ? "" : "s"} inferred`} from fields named after another object (CUSTOMER_ID → CUSTOMER). Keys are not recorded, so read the relations as hints.`}
        >
          {model === undefined ? <p className="text-[12px] text-text-muted">No data objects at this ref.</p> : <MermaidDiagram source={model.source} title="Data model" height={640} />}
        </Section>
      ) : null}
      {tab === "document" && document !== undefined ? (
        <Section title={document.title} description={document.path}>
          <Markdown text={document.markdown} path={document.path} />
        </Section>
      ) : null}

      <DetailPage open={opened !== undefined} title={opened?.object.name ?? ""} subtitle={opened?.object.source === undefined ? undefined : <InlineText text={opened.object.source} className="font-mono" />} onClose={() => setOpen(undefined)}>
        {opened === undefined ? null : <ObjectDetail use={opened} onOpenItem={onOpenItem} />}
      </DetailPage>
    </div>
  );
}

function Overview({ uses, stores, onObject }: { uses: ObjectUse[]; stores: StoreUse[]; onObject: (name: string) => void }): React.JSX.Element {
  const objects = [...uses].sort((a, b) => b.rules.length + b.units.length - (a.rules.length + a.units.length) || b.object.fields.length - a.object.fields.length).slice(0, 10);
  const busiest = stores.filter((store) => store.readers.length + store.writers.length > 0).slice(0, 10);
  const contested = stores.filter((store) => store.writers.length > 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Objects by use" description="Objects the most rules and units use; the note is the field count.">
          {objects.length === 0 ? (
            <p className="text-[12px] text-text-muted">No data objects at this ref.</p>
          ) : (
            <BarList
              format={formatCount}
              color={CHART_COLOR.teal}
              rows={objects.map((use) => ({ key: use.object.name, label: use.object.name, value: use.rules.length + use.units.length, note: `${use.object.fields.length} fields`, onClick: () => onObject(use.object.name) }))}
              onSelect={(row) => onObject(row.key)}
            />
          )}
        </Section>
        <Section title="Stores by access" description="Data stores the most units read or write.">
          {busiest.length === 0 ? (
            <p className="text-[12px] text-text-muted">No unit touches a data store at this ref.</p>
          ) : (
            <BarList format={formatCount} rows={busiest.map((store) => ({ key: store.id, label: store.name, value: store.readers.length + store.writers.length, note: `${store.writers.length} write` }))} />
          )}
        </Section>
      </div>
      {contested.length === 0 ? null : (
        <Section title="Written by several units" description="A store with more than one writer is where a migration has to agree on one owner.">
          <ul className="flex flex-col gap-1 text-[13px] text-text-secondary">
            {contested.slice(0, 12).map((store) => (
              <li key={store.id}>
                <span className="font-mono text-text">{store.name}</span> — {store.writers.length} writers: {store.writers.slice(0, 5).map((unit) => unit.title || unit.key).join(", ")}
                {store.writers.length > 5 ? ` +${store.writers.length - 5}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ObjectsTab({ uses, onOpen }: { uses: ObjectUse[]; onOpen: (name: string) => void }): React.JSX.Element {
  if (uses.length === 0) return <EmptyState title="No data objects at this ref" description="extract-rules lists the core records the rules read and write in DATA_OBJECTS.md." />;
  const columns: Column<ObjectUse>[] = [
    { id: "name", header: "Object", cell: (row) => <span className="font-medium text-text">{row.object.name}</span>, sort: (row) => row.object.name },
    { id: "source", header: "Source", cell: (row) => <span className="font-mono text-[11.5px] text-text-secondary">{row.object.source ?? "—"}</span>, sort: (row) => row.object.source },
    { id: "fields", header: "Fields", align: "right", cell: (row) => <span className="tabular-nums">{row.object.fields.length}</span>, sort: (row) => row.object.fields.length },
    { id: "rules", header: "Rules", align: "right", cell: (row) => <span className="tabular-nums">{row.rules.length || row.object.consumedBy.length}</span>, sort: (row) => row.rules.length || row.object.consumedBy.length },
    { id: "units", header: "Units", align: "right", cell: (row) => <span className="tabular-nums">{row.units.length}</span>, sort: (row) => row.units.length },
  ];
  return (
    <Section title="Data objects" description="The core records of the legacy system. Select one for its fields, the rules and the units that use it.">
      <DataTable label="Data objects" rows={uses} rowKey={(row) => row.object.name} columns={columns} searchPlaceholder="Filter objects" initialSort={{ id: "units", desc: true }} pageSize={25} onRowClick={(row) => onOpen(row.object.name)} empty="No object matches." />
    </Section>
  );
}

function StoresTab({ stores, onOpenItem }: { stores: StoreUse[]; onOpenItem?: ((item: string) => void) | undefined }): React.JSX.Element {
  if (stores.length === 0) return <EmptyState title="No data stores at this ref" description="The topology lists the tables, files and datasets; understand records which units touch them." />;
  const units = (list: UnderstandUnit[], programs: string[]): React.ReactNode =>
    list.length === 0 && programs.length === 0 ? (
      <span className="text-text-muted">—</span>
    ) : list.length === 0 ? (
      <span className="text-[12px] text-text-secondary" title="Programs of the topology; no unit that touches it is understood yet">
        {programs.slice(0, 4).join(", ")}
        {programs.length > 4 ? ` +${programs.length - 4}` : ""}
      </span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {list.slice(0, 4).map((unit) => (
          <button
            key={unit.key}
            type="button"
            title={unit.key}
            onClick={(event) => {
              event.stopPropagation();
              onOpenItem?.(unit.key);
            }}
            className="rounded-[4px] bg-hover px-1.5 py-px text-[11px] text-text-secondary hover:text-text"
          >
            {unit.title || unit.key}
          </button>
        ))}
        {list.length > 4 ? <span className="text-[11px] text-text-muted">+{list.length - 4}</span> : null}
      </span>
    );
  const columns: Column<StoreUse>[] = [
    { id: "name", header: "Store", cell: (row) => <span className="font-mono text-[12px] text-text">{row.name}</span>, sort: (row) => row.name },
    { id: "writers", header: "Written by", cell: (row) => units(row.writers, row.programs.writers), sort: (row) => row.writers.length + row.programs.writers.length, search: (row) => [...row.writers.map((unit) => unit.title), ...row.programs.writers].join(" ") },
    { id: "readers", header: "Read by", cell: (row) => units(row.readers, row.programs.readers), sort: (row) => row.readers.length + row.programs.readers.length, search: (row) => [...row.readers.map((unit) => unit.title), ...row.programs.readers].join(" ") },
  ];
  return (
    <Section title="Data stores" description="Tables, files and datasets, with who writes and reads them: the units understood so far, else the programs of the topology.">
      <DataTable label="Data stores" rows={stores} rowKey={(row) => row.id} columns={columns} searchPlaceholder="Filter stores" pageSize={25} empty="No store matches." />
    </Section>
  );
}

/** The leaf-level lineage the topology step drew, when it wrote one. */
function LeafLineage({ map }: { map: MapResults }): React.JSX.Element | null {
  const diagram = map.diagrams.find((entry) => entry.id === "data-lineage");
  if (diagram === undefined) return null;
  return (
    <Section title="Lineage from the topology" description={`${diagram.path}: the programs and the stores they read and write, before any unit is understood.`}>
      <MermaidDiagram source={diagram.source} title={diagram.title} height={560} />
    </Section>
  );
}

function ObjectDetail({ use, onOpenItem }: { use: ObjectUse; onOpenItem?: ((item: string) => void) | undefined }): React.JSX.Element {
  const rules = use.rules.length > 0 ? use.rules : [];
  return (
    <div className="flex flex-col gap-4">
      <Section title="Fields" description={`${use.object.fields.length} field${use.object.fields.length === 1 ? "" : "s"}`}>
        <DataTable
          label={`Fields of ${use.object.name}`}
          rows={use.object.fields}
          rowKey={(row) => row.name}
          pageSize={0}
          minWidth={420}
          columns={[
            { id: "name", header: "Field", cell: (row) => <span className="font-mono text-[12px] text-text">{row.name}</span>, sort: (row) => row.name },
            { id: "type", header: "Type", cell: (row) => <span className="font-mono text-[12px] text-text-secondary">{row.type ?? "—"}</span>, sort: (row) => row.type },
            { id: "note", header: "Note", cell: (row) => <InlineText text={row.note ?? "—"} className="text-[12px] text-text-secondary" /> },
          ]}
        />
      </Section>
      <Field label={`Rules (${use.object.consumedBy.length})`}>
        <div className="flex flex-wrap gap-1">
          {(rules.length > 0 ? rules.map((rule: CatalogRule) => ({ key: rule.id, text: rule.id, title: rule.name })) : use.object.consumedBy.map((name) => ({ key: name, text: name, title: name }))).map((chip) => (
            <span key={chip.key} title={chip.title} className="rounded-[4px] bg-hover px-1.5 py-px font-mono text-[11px] text-text-secondary">
              {chip.text}
            </span>
          ))}
        </div>
      </Field>
      <Field label={`Units (${use.units.length})`}>
        <div className="flex flex-wrap gap-1">
          {use.units.map((unit) => (
            <button key={unit.key} type="button" title={unit.key} onClick={() => onOpenItem?.(unit.key)} className="rounded-[4px] bg-hover px-1.5 py-px text-[11.5px] text-text-secondary hover:text-text">
              {unit.title || unit.key}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
