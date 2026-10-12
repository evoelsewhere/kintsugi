// Builds a Mermaid flowchart from topology.json: one subgraph per domain, node shapes by kind
// (module, data store, job, screen), domain colours, entry points and dead-end candidates as
// classes, and edges labelled by type. Large topologies are cut to a readable view: filter by
// domain, focus a node with a depth, and at most MAX_NODES nodes (the largest by lines of code).
// Node ids are replaced by n0, n1, … so any id is safe in Mermaid; `ids` maps them back.

import type { MapNode, TopoEdge } from "@/lib/api/documents";
import { edgeColor } from "./results-format";

export const MAX_NODES = 120;

export interface TopologyView {
  /** Only nodes of this domain (ignored while focusing a node). */
  domain?: string;
  /** Only this node and the nodes within `depth` edges of it, in either direction. */
  focus?: string;
  depth: number;
  /** Edge kinds to leave out. */
  hiddenKinds: ReadonlySet<string>;
  /** Highlighted node. */
  selected?: string;
}

export interface TopologyFlowchart {
  source: string;
  /** Mermaid id (n0, n1, …) → topology node id. */
  ids: Map<string, string>;
  shown: number;
  /** Nodes that pass the domain and focus filters, before the MAX_NODES cut. */
  matching: number;
}

/** Mermaid text in a quoted label: entity codes for the characters that end or break it. */
const label = (text: string): string =>
  `"${text.replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/[\r\n]+/g, " ")}"`;

const SHAPES: Record<string, (text: string) => string> = {
  module: (text) => `(${text})`,
  datastore: (text) => `[(${text})]`,
  job: (text) => `{{${text}}}`,
  screen: (text) => `[/${text}/]`,
};

const ARROWS: Record<string, string> = { dispatch: "-.->", write: "==>" };

/** The ids within `depth` edges of `focus`, following edges both ways. */
function neighbourhood(focus: string, depth: number, edges: readonly TopoEdge[]): Set<string> {
  const reached = new Set([focus]);
  let frontier = [focus];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const edge of edges) {
      for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
        if (frontier.includes(from) && !reached.has(to)) {
          reached.add(to);
          next.push(to);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

export function topologyFlowchart(nodes: readonly MapNode[], allEdges: readonly TopoEdge[], domains: readonly string[], colors: ReadonlyMap<string, string>, view: TopologyView): TopologyFlowchart {
  const edges = allEdges.filter((edge) => !view.hiddenKinds.has(edge.kind));
  // A focus wins over the domain filter: its neighbours from other domains stay visible.
  const near = view.focus !== undefined && nodes.some((node) => node.id === view.focus) ? neighbourhood(view.focus, view.depth, edges) : undefined;
  const candidates = nodes.filter((node) => (near === undefined ? view.domain === undefined || node.domain === view.domain : near.has(node.id)));
  const matching = candidates.length;
  const kept =
    candidates.length <= MAX_NODES
      ? candidates
      : [...candidates].sort((a, b) => (b.id === view.focus ? 1 : 0) - (a.id === view.focus ? 1 : 0) || b.loc - a.loc).slice(0, MAX_NODES);

  const ids = new Map<string, string>();
  const mermaidId = new Map<string, string>();
  kept.forEach((node, index) => {
    ids.set(`n${index}`, node.id);
    mermaidId.set(node.id, `n${index}`);
  });

  const lines = ["flowchart LR"];
  const nodeLine = (node: MapNode): string => `${mermaidId.get(node.id)!}${(SHAPES[node.kind] ?? ((text: string) => `[${text}]`))(label(node.name))}`;
  domains.forEach((domain, index) => {
    const members = kept.filter((node) => node.domain === domain);
    if (members.length === 0) return;
    lines.push(`  subgraph g${index}[${label(domain)}]`, ...members.map((node) => `    ${nodeLine(node)}`), "  end");
  });
  for (const node of kept) if (node.domain === undefined || !domains.includes(node.domain)) lines.push(`  ${nodeLine(node)}`);

  const shownEdges = edges.filter((edge) => mermaidId.has(edge.source) && mermaidId.has(edge.target));
  shownEdges.forEach((edge) => lines.push(`  ${mermaidId.get(edge.source)!} ${ARROWS[edge.kind] ?? "-->"}|${label(edge.kind)}| ${mermaidId.get(edge.target)!}`));
  shownEdges.forEach((edge, index) => lines.push(`  linkStyle ${index} stroke:${edgeColor(edge.kind)}`));

  // Colours: one class per domain; entry points, dead ends and the selection on top.
  lines.push("  classDef nodomain fill:#8f8f8f,fill-opacity:0.12,stroke:#8f8f8f,stroke-width:1.5px");
  domains.forEach((domain, index) => {
    const color = colors.get(domain) ?? "#8f8f8f";
    lines.push(`  classDef d${index} fill:${color},fill-opacity:0.16,stroke:${color},stroke-width:1.5px`);
  });
  lines.push("  classDef entry stroke-width:4px", "  classDef dead stroke-dasharray:5 3,fill-opacity:0.05", "  classDef selected stroke-width:4px,fill-opacity:0.4");
  const assign = (className: string, members: MapNode[]): void => {
    if (members.length > 0) lines.push(`  class ${members.map((node) => mermaidId.get(node.id)!).join(",")} ${className}`);
  };
  domains.forEach((domain, index) => assign(`d${index}`, kept.filter((node) => node.domain === domain)));
  assign("nodomain", kept.filter((node) => node.domain === undefined || !domains.includes(node.domain)));
  assign("entry", kept.filter((node) => node.entryPoint));
  assign("dead", kept.filter((node) => node.deadEnd));
  assign("selected", kept.filter((node) => node.id === view.selected));

  return { source: lines.join("\n"), ids, shown: kept.length, matching };
}
