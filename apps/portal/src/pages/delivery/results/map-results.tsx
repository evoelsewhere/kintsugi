// Results of map: the dependency graph of topology.md as a Mermaid flowchart (filter by
// domain, focus a node with a depth) with a node panel, the nodes table, entry points and data
// stores, the persona flows and observations, and the three diagrams (call graph, data lineage,
// critical path).

import { Database, DoorOpen, Lightbulb, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { InlineText } from "@/components/results/inline-text";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";
import { StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { DetailPage } from "@/components/detail-page";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { MapNode, MapResults, TopoEdge, TopoFlow } from "@/lib/api/documents";
import { cn } from "@/lib/utils";
import { domainColors, edgeColor, formatCount } from "./results-format";
import { CountChip, Field, Kpi, KpiRow, Section, SubTabs } from "./results-parts";
import { MapOverview } from "./map-overview";
import { topologyFlowchart } from "./topology-mermaid";

type Tab = "overview" | "graph" | "nodes" | "diagrams" | "flows";

type Topology = NonNullable<MapResults["topology"]>;

export function MapResultsView({ results, compare }: { results: MapResults; compare: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const topology = results.topology;
  const previous = compare ? results.previous?.counts : undefined;
  const counts = results.counts;

  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Modules" value={counts["modules"]} previous={previous?.["modules"]} hint={topology === null ? undefined : `${topology.domains.length} domains`} />
        <Kpi label="Edges" value={counts["edges"]} previous={previous?.["edges"]} />
        <Kpi label="Entry points" value={counts["entryPoints"]} previous={previous?.["entryPoints"]} />
        <Kpi label="Dead-end candidates" value={counts["deadEnds"]} previous={previous?.["deadEnds"]} />
        <Kpi label="Data stores" value={counts["dataStores"]} previous={previous?.["dataStores"]} />
        <Kpi label="Persona flows" value={counts["flows"]} previous={previous?.["flows"]} />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "graph", label: "Dependency graph" },
          { id: "nodes", label: "Nodes", count: topology?.nodes.length },
          { id: "diagrams", label: "Diagrams", count: results.diagrams.length },
          { id: "flows", label: "Flows & observations", count: topology === null ? undefined : topology.flows.length + topology.observations.length },
        ]}
      />

      {topology === null && (tab === "overview" || tab === "graph" || tab === "nodes" || tab === "flows") ? (
        <EmptyState title="No topology at this ref" description="The assess stage writes topology.md and the understand stage a topology.md per item; pick another ref above." />
      ) : null}
      {tab === "overview" && topology !== null ? <MapOverview topology={topology} onOpen={setDetail} onFlows={() => setTab("flows")} /> : null}
      {tab === "graph" && topology !== null ? <GraphTab topology={topology} /> : null}
      {tab === "nodes" && topology !== null ? <NodesTab topology={topology} onOpen={setDetail} /> : null}
      {tab === "diagrams" ? <DiagramsTab results={results} /> : null}
      {tab === "flows" && topology !== null ? <FlowsTab topology={topology} onOpen={setDetail} /> : null}

      {topology === null ? null : (
        <DetailPage open={detail !== undefined} title={topology.nodes.find((node) => node.id === detail)?.name ?? ""} subtitle={detail} onClose={() => setDetail(undefined)}>
          {detail === undefined ? null : <NodeDetail topology={topology} id={detail} onOpen={setDetail} />}
        </DetailPage>
      )}
    </div>
  );
}

const DEPTHS = [
  { value: "1", label: "1 hop" },
  { value: "2", label: "2 hops" },
  { value: "3", label: "3 hops" },
  { value: "99", label: "All reachable" },
];

function GraphTab({ topology }: { topology: Topology }): React.JSX.Element {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [domain, setDomain] = useState("");
  const [focus, setFocus] = useState("");
  const [depth, setDepth] = useState("1");
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(new Set());
  const colors = useMemo(() => domainColors(topology.domains), [topology.domains]);
  const kinds = useMemo(() => [...new Set(topology.edges.map((edge) => edge.kind))], [topology.edges]);
  const chart = useMemo(
    () =>
      topologyFlowchart(topology.nodes, topology.edges, topology.domains, colors, {
        ...(domain === "" ? {} : { domain }),
        ...(focus === "" ? {} : { focus }),
        depth: Number(depth),
        hiddenKinds,
        ...(selected === undefined ? {} : { selected }),
      }),
    [topology, colors, domain, focus, depth, hiddenKinds, selected],
  );
  const toggle = (kind: string): void =>
    setHiddenKinds((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const nodeOptions = [
    { value: "", label: "Whole map" },
    ...[...topology.nodes].sort((a, b) => a.name.localeCompare(b.name)).map((node) => ({ value: node.id, label: node.name, hint: node.domain ?? node.kind })),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Section
        title={topology.system === "" ? "Dependency graph" : `${topology.system} · dependency graph`}
        description="Modules grouped by domain; click a node for its details, drag to pan. Thick outline: entry point; dashed: dead-end candidate. Dashed edges dispatch, thick edges write."
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select size="small"
              value={domain}
              disabled={focus !== ""}
              options={[{ value: "", label: "All domains" }, ...topology.domains.map((entry) => ({ value: entry, label: entry, hint: String(topology.nodes.filter((node) => node.domain === entry).length) }))]}
              onChange={setDomain}
            />
            <Select size="small" value={focus} options={nodeOptions} onChange={setFocus} />
            <Select size="small" value={depth} disabled={focus === ""} options={DEPTHS} onChange={setDepth} />
          </div>
          <NodeFinder
            nodes={topology.nodes}
            onPick={(id) => {
              setFocus(id);
              setSelected(id);
            }}
          />
          {chart.shown < chart.matching ? (
            <p className="text-[12px] text-text-secondary">
              Showing the {chart.shown} largest of {formatCount(chart.matching)} nodes: pick a domain or focus a node to see the rest.
            </p>
          ) : null}
          {chart.shown === 0 ? (
            <p className="rounded-lg bg-recessed/60 p-4 text-[12px] text-text-muted">No node matches this view.</p>
          ) : (
            <MermaidDiagram
              key={`${domain}/${focus}/${depth}`}
              source={chart.source}
              title={`${chart.shown} ${chart.shown === 1 ? "node" : "nodes"}`}
              height={560}
              onNodeClick={(id) => setSelected(chart.ids.get(id))}
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-text-secondary">
            <span className="text-[11px] tracking-wide text-text-muted uppercase">Domains</span>
            {topology.domains.map((entry) => (
              <span key={entry} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: colors.get(entry) }} />
                {entry}
              </span>
            ))}
          </div>
          {kinds.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-[11px] tracking-wide text-text-muted uppercase">Edges</span>
              {kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={!hiddenKinds.has(kind)}
                  onClick={() => toggle(kind)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[var(--geist-pill-radius)] px-2.5 shadow-border hover:bg-hover",
                    hiddenKinds.has(kind) ? "text-text-muted line-through" : "text-text-secondary",
                  )}
                >
                  <span className="h-0.5 w-4 rounded" style={{ backgroundColor: edgeColor(kind) }} />
                  {kind} · {topology.edges.filter((edge) => edge.kind === kind).length}
                </button>
              ))}
            </div>
          )}
        </div>
      </Section>
      <Section
        title="Node"
        description={selected === undefined ? "Click a node in the graph." : selected}
        actions={
          selected === undefined || selected === focus ? undefined : (
            <Button size="small" variant="ghost" className="shadow-border" onClick={() => setFocus(selected)}>
              Focus
            </Button>
          )
        }
      >
        {selected === undefined ? (
          <p className="text-[12px] text-text-muted">Its description, files, inbound and outbound dependencies and data stores appear here.</p>
        ) : (
          <NodeDetail topology={topology} id={selected} onOpen={setSelected} />
        )}
      </Section>
    </div>
  );
}

/** Finds a node among all of them (the graph draws only the largest): by name, id, file or domain; picking one focuses it. */
function NodeFinder({ nodes, onPick }: { nodes: MapNode[]; onPick: (id: string) => void }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const found = useMemo(
    () => (needle === "" ? [] : nodes.filter((node) => [node.name, node.id, node.file ?? "", node.domain ?? ""].some((text) => text.toLowerCase().includes(needle)))),
    [nodes, needle],
  );
  const pick = (id: string): void => {
    onPick(id);
    setQuery("");
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-text-muted" strokeWidth={1.75} />
        <input
          type="search"
          value={query}
          placeholder={`Find any of the ${formatCount(nodes.length)} nodes by name, id or file`}
          aria-label="Find a node"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = found[0];
            if (event.key === "Enter" && first !== undefined) pick(first.id);
          }}
          className="shadow-border h-[var(--geist-form-small-height)] w-full rounded-[var(--geist-radius)] bg-transparent pr-3 pl-8 text-[13px] text-text placeholder:text-text-muted focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:outline-auto focus-visible:shadow-none"
        />
      </label>
      {needle === "" ? null : found.length === 0 ? (
        <p className="px-1 text-[12px] text-text-muted">No node matches.</p>
      ) : (
        <ul className="shadow-border max-h-56 overflow-auto rounded-lg bg-surface p-1">
          {found.slice(0, 20).map((node) => (
            <li key={node.id}>
              <NodeLink node={node} onOpen={pick} />
            </li>
          ))}
          {found.length > 20 ? <li className="px-1.5 py-1 text-[11px] text-text-muted">{formatCount(found.length - 20)} more: type more of the name.</li> : null}
        </ul>
      )}
    </div>
  );
}

const byId = (topology: Topology): Map<string, MapNode> => new Map(topology.nodes.map((node) => [node.id, node]));

function NodeLink({ node, onOpen, edge }: { node: MapNode | undefined; onOpen: (id: string) => void; edge?: TopoEdge }): React.JSX.Element | null {
  if (node === undefined) return null;
  return (
    <button type="button" onClick={() => onOpen(node.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-hover">
      {node.kind === "datastore" ? <Database className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} /> : null}
      <span className="min-w-0 flex-1 truncate text-text">{node.name}</span>
      {edge === undefined ? null : (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-text-muted">
          <span className="h-0.5 w-3 rounded" style={{ backgroundColor: edgeColor(edge.kind) }} />
          {edge.kind}
        </span>
      )}
    </button>
  );
}

function NodeDetail({ topology, id, onOpen }: { topology: Topology; id: string; onOpen: (id: string) => void }): React.JSX.Element {
  const nodes = byId(topology);
  const node = nodes.get(id);
  if (node === undefined) return <p className="text-[12px] text-text-muted">This node is not in the topology.</p>;
  const outbound = topology.edges.filter((edge) => edge.source === id);
  const inbound = topology.edges.filter((edge) => edge.target === id);
  const stores = [...outbound.map((edge) => nodes.get(edge.target)), ...inbound.map((edge) => nodes.get(edge.source))].filter((other): other is MapNode => other?.kind === "datastore");
  const flows = topology.flows.filter((flow) => flow.steps.some((step) => step.nodes.includes(id)));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge tone="muted" label={node.kind} />
        {node.domain === undefined ? null : <StatusBadge tone="blue" label={node.domain} />}
        {node.language === undefined ? null : <StatusBadge tone="muted" label={node.language} />}
        {node.entryPoint ? <StatusBadge tone="orange" label="Entry point" /> : null}
        {node.deadEnd ? <StatusBadge tone="muted" label="Dead-end candidate" /> : null}
      </div>
      <Field label="Description">{node.description === undefined ? <span className="text-text-muted">No description was accepted for this node.</span> : <InlineText text={node.description} />}</Field>
      <Field label="Source">
        {node.file === undefined ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span>
            <code className="font-mono text-[12px] text-text">{node.file}</code>
            {node.loc > 0 ? <span className="text-text-muted"> · {formatCount(node.loc)} lines</span> : null}
          </span>
        )}
      </Field>
      <Field label={`Calls and uses (${outbound.length})`}>
        {outbound.length === 0 ? <span className="text-text-muted">Nothing.</span> : outbound.map((edge, index) => <NodeLink key={index} node={nodes.get(edge.target)} edge={edge} onOpen={onOpen} />)}
      </Field>
      <Field label={`Used by (${inbound.length})`}>
        {inbound.length === 0 ? <span className="text-text-muted">Nothing in the repository.</span> : inbound.map((edge, index) => <NodeLink key={index} node={nodes.get(edge.source)} edge={edge} onOpen={onOpen} />)}
      </Field>
      {stores.length === 0 ? null : <Field label="Data stores">{stores.map((store) => <NodeLink key={store.id} node={store} onOpen={onOpen} />)}</Field>}
      {flows.length === 0 ? null : (
        <Field label="Persona flows">
          <ul className="flex flex-col gap-1">
            {flows.map((flow) => (
              <li key={flow.name} className="text-[12px]">
                {flow.name}
              </li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}

function NodesTab({ topology, onOpen }: { topology: Topology; onOpen: (id: string) => void }): React.JSX.Element {
  const nodes = byId(topology);
  const [kind, setKind] = useState<string>("");
  const kinds = [...new Set(topology.nodes.map((node) => node.kind))];
  const entries = topology.nodes.filter((node) => node.entryPoint);
  const stores = topology.nodes.filter((node) => node.kind === "datastore");
  const columns: Column<MapNode>[] = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-text">{row.name}</p>
          {row.file === undefined ? null : <p className="truncate font-mono text-[11px] text-text-muted">{row.file}</p>}
        </div>
      ),
      sort: (row) => row.name,
      search: (row) => `${row.name} ${row.file ?? ""} ${row.id}`,
    },
    { id: "kind", header: "Kind", cell: (row) => <span className="text-text-secondary">{row.kind}</span>, sort: (row) => row.kind },
    { id: "domain", header: "Domain", cell: (row) => <span className="text-text-secondary">{row.domain ?? "—"}</span>, sort: (row) => row.domain },
    { id: "loc", header: "LOC", cell: (row) => (row.loc > 0 ? formatCount(row.loc) : "—"), sort: (row) => row.loc, align: "right" },
    { id: "in", header: "In", cell: (row) => row.inDegree, sort: (row) => row.inDegree, align: "right", title: "Inbound edges" },
    { id: "out", header: "Out", cell: (row) => row.outDegree, sort: (row) => row.outDegree, align: "right", title: "Outbound edges" },
    {
      id: "flags",
      header: "Flags",
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.entryPoint ? <StatusBadge tone="orange" label="Entry" /> : null}
          {row.deadEnd ? <StatusBadge tone="muted" label="Dead end?" /> : null}
        </span>
      ),
      sort: (row) => (row.entryPoint ? 0 : row.deadEnd ? 1 : 2),
    },
    { id: "description", header: "Description", cell: (row) => <span className="line-clamp-2 text-[12px] text-text-secondary">{row.description ?? "—"}</span>, search: (row) => row.description ?? "", className: "max-w-[360px]" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Entry points" description="Where control enters the application from outside the repository.">
          {entries.length === 0 ? (
            <p className="text-[12px] text-text-muted">The map found no entry point.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {entries.map((node) => (
                <li key={node.id} className="flex items-center gap-2">
                  <DoorOpen className="size-3.5 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                  <NodeLink node={node} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Data stores" description="Tables, files and datasets, with who reads and writes them.">
          {stores.length === 0 ? (
            <p className="text-[12px] text-text-muted">The map recorded no data store nodes.</p>
          ) : (
            <DataTable
              label="Data stores"
              rows={stores}
              rowKey={(row) => row.id}
              onRowClick={(row) => onOpen(row.id)}
              pageSize={0}
              minWidth={420}
              columns={[
                { id: "name", header: "Store", cell: (row) => <span className="text-text">{row.name}</span>, sort: (row) => row.name },
                { id: "readers", header: "Read by", cell: (row) => accessors(topology, nodes, row.id, "read"), search: (row) => accessors(topology, nodes, row.id, "read") },
                { id: "writers", header: "Written by", cell: (row) => accessors(topology, nodes, row.id, "write"), search: (row) => accessors(topology, nodes, row.id, "write") },
              ]}
            />
          )}
        </Section>
      </div>
      <Section title="Nodes" description="Every module, store, job and screen of the topology; open one for its dependencies.">
        <DataTable
          label="Nodes"
          rows={kind === "" ? topology.nodes : topology.nodes.filter((node) => node.kind === kind)}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={(row) => onOpen(row.id)}
          searchPlaceholder="Search nodes, files, descriptions"
          initialSort={{ id: "in", desc: true }}
          toolbar={
            kinds.length < 2 ? undefined : (
              <div className="flex flex-wrap gap-1">
                <CountChip label="All" count={topology.nodes.length} active={kind === ""} onClick={() => setKind("")} />
                {kinds.map((entry) => (
                  <CountChip key={entry} label={entry} count={topology.nodes.filter((node) => node.kind === entry).length} active={kind === entry} onClick={() => setKind(kind === entry ? "" : entry)} />
                ))}
              </div>
            )
          }
        />
      </Section>
    </div>
  );
}

/** The nodes that reach a store by an edge of the kind (`read`, `write`); calls count as reads. */
function accessors(topology: Topology, nodes: Map<string, MapNode>, store: string, kind: "read" | "write"): string {
  const names = topology.edges
    .filter((edge) => edge.target === store && (edge.kind === kind || (kind === "read" && edge.kind !== "write")))
    .map((edge) => nodes.get(edge.source)?.name ?? edge.source);
  return names.length === 0 ? "—" : [...new Set(names)].join(", ");
}

function DiagramsTab({ results }: { results: MapResults }): React.JSX.Element {
  const [active, setActive] = useState<string>(results.diagrams[0]?.id ?? "");
  if (results.diagrams.length === 0) return <EmptyState title="No diagrams at this ref" description="The topology step of assess writes call-graph.mmd, data-lineage.mmd and critical-path.mmd beside topology.md; a run made before it did has none, so run assess again." />;
  const diagram = results.diagrams.find((entry) => entry.id === active) ?? results.diagrams[0]!;
  return (
    <Section
      title={diagram.title}
      description={diagram.path}
      actions={
        <SubTabs value={diagram.id} onChange={setActive} tabs={results.diagrams.map((entry) => ({ id: entry.id, label: entry.title }))} />
      }
    >
      <MermaidDiagram key={diagram.id} source={diagram.source} title={diagram.title} height={560} />
    </Section>
  );
}

function FlowsTab({ topology, onOpen }: { topology: Topology; onOpen: (id: string) => void }): React.JSX.Element {
  const nodes = byId(topology);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <Section title="Persona flows" description="End-to-end journeys in business language, step by step through the nodes.">
        {topology.flows.length === 0 ? (
          <p className="text-[12px] text-text-muted">No persona flows at this ref.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {topology.flows.map((flow) => (
              <FlowView key={flow.name} flow={flow} nodes={nodes} onOpen={onOpen} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Architect observations" description="Coupling clusters, single points of failure, extraction candidates, unresolved targets.">
        {topology.observations.length === 0 ? (
          <p className="text-[12px] text-text-muted">No observations at this ref.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {topology.observations.map((observation) => (
              <li key={observation} className="flex gap-2 text-[13px] leading-6 text-text-secondary">
                <Lightbulb className="mt-1 size-4 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                <InlineText text={observation} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function FlowView({ flow, nodes, onOpen }: { flow: TopoFlow; nodes: Map<string, MapNode>; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <div>
      <p className="text-[14px] font-medium text-text">{flow.name}</p>
      {flow.persona === undefined ? null : <p className="text-[12px] text-text-muted">{flow.persona}</p>}
      {flow.description === undefined ? null : <p className="mt-1 text-[13px] text-text-secondary">{flow.description}</p>}
      <ol className="mt-2 flex flex-col gap-1.5">
        {flow.steps.map((step, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-[11px] font-medium text-text-secondary">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-[13px] text-text">{step.label}</p>
              <p className="flex flex-wrap gap-1 pt-0.5">
                {step.nodes.map((id) => (
                  <button key={id} type="button" onClick={() => onOpen(id)} className="inline-flex items-center gap-1 rounded-[4px] bg-hover px-1.5 py-px font-mono text-[11px] text-text-secondary hover:text-text">
                    {nodes.get(id)?.name ?? id}
                  </button>
                ))}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
