// The Overview of map results: how the modules split by domain and kind, the edge mix, the
// most depended-on and most dependent nodes, lines of code per domain, and the architect's
// observations. Figures come from the topology document only (a long topology lists its largest leaves).

import { BarList, Donut, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { InlineText } from "@/components/results/inline-text";
import type { MapResults } from "@/lib/api/documents";
import { countBy, domainColors, edgeColor, formatCount, percentOf, segmentsOf, topWithOthers } from "./results-format";
import { Distribution, MoreLink, Section, Signal, SignalList } from "./results-parts";

type Topology = NonNullable<MapResults["topology"]>;

export function MapOverview({ topology, onOpen, onFlows }: { topology: Topology; onOpen: (id: string) => void; onFlows: () => void }): React.JSX.Element {
  const { nodes, edges } = topology;
  const domainOf = (node: Topology["nodes"][number]): string => node.domain ?? "(no domain)";
  const byDomain = countBy(nodes, domainOf);
  const colors = domainColors(byDomain.map((entry) => entry.key));
  const kinds = countBy(nodes, (node) => node.kind);
  const edgeKinds = countBy(edges, (edge) => edge.kind);
  const fanIn = [...nodes].sort((a, b) => b.inDegree - a.inDegree).filter((node) => node.inDegree > 0).slice(0, 10);
  const fanOut = [...nodes].sort((a, b) => b.outDegree - a.outDegree).filter((node) => node.outDegree > 0).slice(0, 10);
  const locByDomain = [...nodes.reduce((sum, node) => sum.set(domainOf(node), (sum.get(domainOf(node)) ?? 0) + node.loc), new Map<string, number>())]
    .filter(([, loc]) => loc > 0)
    .sort((a, b) => b[1] - a[1]);
  const entryPoints = nodes.filter((node) => node.entryPoint).length;
  const deadEnds = nodes.filter((node) => node.deadEnd).length;
  const top = fanIn[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Modules by domain" description="Nodes of the topology grouped by the domain the map assigned." className="lg:col-span-3">
          <Donut segments={segmentsOf(topWithOthers(byDomain, 7), (key) => colors.get(key))} format={formatCount} center={formatCount(nodes.length)} caption="nodes" />
        </Section>
        <Section title="Signals" description="Figures derived from the topology." className="lg:col-span-2">
          <SignalList>
            <Signal label="Dependencies per node" value={nodes.length === 0 ? "—" : (edges.length / nodes.length).toFixed(1)} note={`${formatCount(edges.length)} edges`} />
            <Signal label="Entry points" value={formatCount(entryPoints)} note={percentOf(entryPoints, nodes.length)} />
            <Signal label="Dead-end candidates" value={formatCount(deadEnds)} note={percentOf(deadEnds, nodes.length)} />
            <Signal label="Most depended-on" value={top === undefined ? "—" : `${top.inDegree} in`} note={top?.name} title={top?.id} />
            <Signal label="Largest domain" value={byDomain[0]?.key ?? "—"} note={byDomain[0] === undefined ? undefined : percentOf(byDomain[0].count, nodes.length)} />
            <Signal label="Domains" value={formatCount(topology.domains.length)} note={`${formatCount(topology.flows.length)} persona flows`} />
          </SignalList>
        </Section>
      </div>

      <Section title="Mix" description="What the nodes are and how they connect (edge colours as in the graph).">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Distribution title="Node kinds" count={nodes.length}>
            <ShareBar segments={segmentsOf(kinds)} format={formatCount} />
          </Distribution>
          <Distribution title="Edge kinds" count={edges.length}>
            <ShareBar segments={segmentsOf(edgeKinds, edgeColor)} format={formatCount} />
          </Distribution>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Most depended-on" description="Nodes with the most inbound edges: the riskiest to change, the first to stabilise.">
          <BarList format={formatCount} color={CHART_COLOR.blue} onSelect={(row) => onOpen(row.key)} rows={fanIn.map((node) => ({ key: node.id, label: node.name, value: node.inDegree, ...(node.domain === undefined ? {} : { note: node.domain }), title: node.file ?? node.id }))} />
        </Section>
        <Section title="Most dependencies" description="Nodes that call or use the most others: candidates to split.">
          <BarList format={formatCount} color={CHART_COLOR.teal} onSelect={(row) => onOpen(row.key)} rows={fanOut.map((node) => ({ key: node.id, label: node.name, value: node.outDegree, ...(node.domain === undefined ? {} : { note: node.domain }), title: node.file ?? node.id }))} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {locByDomain.length === 0 ? null : (
          <Section title="Lines of code by domain" description="Sum of the module sizes the map recorded.">
            <BarList format={formatCount} rows={locByDomain.map(([domain, loc]) => ({ key: domain, label: domain, value: loc, color: colors.get(domain) ?? CHART_COLOR.blue }))} />
          </Section>
        )}
        {topology.observations.length === 0 ? null : (
          <Section title="Architect observations" description="The first of them; the rest are under Flows & observations." actions={<MoreLink label="All observations" onClick={onFlows} />}>
            <ul className="flex flex-col gap-2 text-[13px] leading-6 text-text-secondary">
              {topology.observations.slice(0, 4).map((observation) => (
                <li key={observation} className="flex gap-2">
                  <span className="mt-2.5 size-1 shrink-0 rounded-full bg-text-muted" />
                  <InlineText text={observation} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
