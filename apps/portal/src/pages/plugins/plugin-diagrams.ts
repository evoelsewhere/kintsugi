// Mermaid sources for a plugin's agentic workflow (ADR-0035): the pipeline of its commands, and for
// one command what it reads, which scripts, workflows and agents run, what it writes and where a
// person decides. Drawn from the plugin's own manifests, so the picture cannot drift from the content.
// Labels are quoted and cleaned (the mermaid-diagrams rules): ids are generated, never taken from names.

import type { PluginFlow, PluginLink } from "@/lib/api/plugins";

/** A label safe inside a quoted Mermaid node: no quotes, no angle brackets, bounded length. */
function label(text: string, max = 56): string {
  const clean = text.replaceAll('"', "'").replaceAll("<", "‹").replaceAll(">", "›").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** `a<br/>b<br/>+2 more`: the first few entries of a list as lines of one node. */
function lines(title: string, entries: readonly string[], keep = 4): string {
  const shown = entries.slice(0, keep).map((entry) => label(entry.replace("assessment/", "").replace("<app>/", ""), 44));
  const more = entries.length > keep ? [`+${entries.length - keep} more`] : [];
  return [`<b>${title}</b>`, ...shown, ...more].join("<br/>");
}

const CLASSES = [
  "classDef runtime fill:#e6f4ea,stroke:#2f7d46,color:#111",
  "classDef member fill:#e8f0fe,stroke:#2b5fb4,color:#111",
  "classDef io fill:#f6f6f6,stroke:#888,color:#111",
  "classDef script fill:#fff,stroke:#666,color:#111",
  "classDef workflow fill:#fdf3e1,stroke:#b9770e,color:#111",
  "classDef agent fill:#f3e8fd,stroke:#7820bc,color:#111",
  "classDef gate fill:#fdecea,stroke:#c0392b,color:#111",
];

export interface Diagram {
  source: string;
  /** Mermaid node id → what a click on it means. */
  targets: Map<string, { kind: "command" | "file"; value: string }>;
}

/** The commands of the plugin in order, linked where one writes what the next reads. */
export function pipelineDiagram(flows: readonly PluginFlow[], pipeline: readonly PluginLink[]): Diagram {
  const targets: Diagram["targets"] = new Map();
  const ids = new Map(flows.map((flow, index) => [flow.command, `c${index}`]));
  const out = ["flowchart LR"];
  for (const flow of flows) {
    const id = ids.get(flow.command)!;
    const gate = flow.gates.length === 0 ? "" : `<br/>${flow.gates.length} decision${flow.gates.length === 1 ? "" : "s"}`;
    out.push(`  ${id}(["<b>${label(flow.command, 24)}</b><br/>${flow.audience}${gate}"]):::${flow.audience === "runtime" ? "runtime" : "member"}`);
    targets.set(id, { kind: "command", value: flow.command });
  }
  for (const link of pipeline) {
    const from = ids.get(link.from);
    const to = ids.get(link.to);
    if (from === undefined || to === undefined) continue;
    const first = link.via[0]?.split("/").at(-1) ?? "";
    out.push(`  ${from} -->|"${label(first, 28)}${link.via.length > 1 ? ` +${link.via.length - 1}` : ""}"| ${to}`);
  }
  out.push(...CLASSES.slice(0, 2).map((line) => `  ${line}`));
  return { source: out.join("\n"), targets };
}

/** One command end to end: reads → what runs → writes → decisions. */
export function commandDiagram(flow: PluginFlow): Diagram {
  const targets: Diagram["targets"] = new Map();
  const out = ["flowchart LR"];
  let counter = 0;
  const node = (text: string, shape: "box" | "sub" | "round" | "stadium" | "diamond", cls: string, file?: string): string => {
    const id = `n${counter++}`;
    const open = { box: "[", sub: "[[", round: "((", stadium: "([", diamond: "{" }[shape];
    const close = { box: "]", sub: "]]", round: "))", stadium: "])", diamond: "}" }[shape];
    out.push(`  ${id}${open}"${text}"${close}:::${cls}`);
    if (file !== undefined) targets.set(id, { kind: "file", value: file });
    return id;
  };

  const start = node(`<b>/${label(flow.command, 24)}</b><br/>${flow.audience}`, "stadium", flow.audience === "runtime" ? "runtime" : "member", flow.path);
  let previous = start;
  if (flow.reads.length > 0) {
    const reads = node(lines("Reads", flow.reads), "box", "io");
    out.push(`  ${reads} --> ${start}`);
  }

  const agents = flow.steps.filter((step) => step.kind === "agent");
  const work = flow.steps.filter((step) => step.kind !== "agent");
  const agentNodes = new Map<string, string>();
  const agentNode = (name: string): string => {
    let id = agentNodes.get(name);
    if (id === undefined) {
      id = node(label(name, 26), "round", "agent", `agents/${name}.md`);
      agentNodes.set(name, id);
    }
    return id;
  };

  for (const step of work) {
    const id =
      step.kind === "workflow"
        ? node(`<b>workflow</b><br/>${label(step.name, 28)}`, "sub", "workflow", step.path)
        : node(`${label(step.name, 28)}<br/>script`, "box", "script", step.path);
    out.push(`  ${previous} --> ${id}`);
    previous = id;
    for (const agent of step.agents ?? []) out.push(`  ${agentNode(agent)} -.-> ${id}`);
  }
  // Agents the command names that no workflow starts act on the command as a whole.
  const inWorkflows = new Set(work.flatMap((step) => step.agents ?? []));
  for (const agent of agents) if (!inWorkflows.has(agent.name)) out.push(`  ${agentNode(agent.name)} -.-> ${start}`);

  if (flow.writes.length > 0) {
    const writes = node(lines("Writes", flow.writes), "box", "io");
    out.push(`  ${previous} --> ${writes}`);
    previous = writes;
  }
  for (const gate of flow.gates) {
    const id = node(label(gate, 70), "diamond", "gate");
    out.push(`  ${previous} --> ${id}`);
  }
  out.push(...CLASSES.map((line) => `  ${line}`));
  return { source: out.join("\n"), targets };
}
