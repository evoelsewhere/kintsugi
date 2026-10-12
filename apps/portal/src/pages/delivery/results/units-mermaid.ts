// Builds Mermaid flowcharts of the understand stage's unit dependencies (traceability.json):
// a module view (one node per module, an edge per module pair labelled with how many unit
// dependencies it carries) and a unit view (one subgraph per module, units as nodes, entry
// points thick, units without a specification dashed), filtered to a module and its direct
// neighbours and cut to MAX_NODES (the largest by lines of code). Ids are replaced by m0/u0, …
// so any name is safe in Mermaid; `ids` maps them back. Same conventions as topology-mermaid.ts.

import type { UnderstandUnit } from "@/lib/api/documents";
import { label, MAX_NODES } from "./topology-mermaid";

export interface UnitsFlowchart {
  source: string;
  /** Mermaid id → module name (module view) or unit id (unit view). */
  ids: Map<string, string>;
  shown: number;
  /** Nodes that pass the filter, before the MAX_NODES cut. */
  matching: number;
  edges: number;
}

const classDefs = (modules: readonly string[], colors: ReadonlyMap<string, string>): string[] =>
  modules.map((module, index) => {
    const color = colors.get(module) ?? "#8f8f8f";
    return `  classDef c${index} fill:${color},fill-opacity:0.16,stroke:${color},stroke-width:1.5px`;
  });

/** One node per module; an edge A → B when a unit of A depends on a unit of B (label: how many). */
export function moduleFlowchart(units: readonly UnderstandUnit[], modules: readonly string[], colors: ReadonlyMap<string, string>): UnitsFlowchart {
  const moduleOf = new Map(units.map((unit) => [unit.id, unit.module]));
  const pairs = new Map<string, number>();
  for (const unit of units) {
    for (const target of unit.dependsOn) {
      const to = moduleOf.get(target);
      if (to === undefined || to === unit.module) continue;
      const key = `${unit.module}\u0000${to}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  const kept = modules.slice(0, MAX_NODES);
  const ids = new Map<string, string>();
  const mermaidId = new Map<string, string>();
  kept.forEach((module, index) => {
    ids.set(`m${index}`, module);
    mermaidId.set(module, `m${index}`);
  });
  const lines = ["flowchart LR"];
  kept.forEach((module) => {
    const count = units.filter((unit) => unit.module === module).length;
    lines.push(`  ${mermaidId.get(module)!}(${label(`${module} · ${count} ${count === 1 ? "unit" : "units"}`)})`);
  });
  let edges = 0;
  for (const [key, count] of [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [from = "", to = ""] = key.split("\u0000");
    if (!mermaidId.has(from) || !mermaidId.has(to)) continue;
    lines.push(`  ${mermaidId.get(from)!} -->|${label(String(count))}| ${mermaidId.get(to)!}`);
    edges += 1;
  }
  lines.push(...classDefs(modules, colors));
  // `kept` is a prefix of `modules`: node m<i> has class c<i>.
  kept.forEach((_, index) => lines.push(`  class m${index} c${index}`));
  return { source: lines.join("\n"), ids, shown: kept.length, matching: modules.length, edges };
}

/** Units grouped by module; with `module`, that module's units and the units they depend on or are used by. */
export function unitFlowchart(units: readonly UnderstandUnit[], modules: readonly string[], colors: ReadonlyMap<string, string>, view: { module?: string; selected?: string }): UnitsFlowchart {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  let candidates: UnderstandUnit[];
  if (view.module === undefined) candidates = [...units];
  else {
    const inModule = units.filter((unit) => unit.module === view.module);
    const near = new Set(inModule.map((unit) => unit.id));
    for (const unit of inModule) for (const id of [...unit.dependsOn, ...unit.usedBy]) near.add(id);
    candidates = [...near].flatMap((id) => byId.get(id) ?? []);
  }
  const matching = candidates.length;
  const kept = candidates.length <= MAX_NODES ? candidates : [...candidates].sort((a, b) => Number(b.module === view.module) - Number(a.module === view.module) || b.loc - a.loc).slice(0, MAX_NODES);

  const ids = new Map<string, string>();
  const mermaidId = new Map<string, string>();
  kept.forEach((unit, index) => {
    ids.set(`u${index}`, unit.id);
    mermaidId.set(unit.id, `u${index}`);
  });

  const lines = ["flowchart LR"];
  modules.forEach((module, index) => {
    const members = kept.filter((unit) => unit.module === module);
    if (members.length === 0) return;
    lines.push(`  subgraph g${index}[${label(module)}]`, ...members.map((unit) => `    ${mermaidId.get(unit.id)!}(${label(unit.unit)})`), "  end");
  });
  let edges = 0;
  for (const unit of kept) {
    for (const target of unit.dependsOn) {
      if (!mermaidId.has(target)) continue;
      lines.push(`  ${mermaidId.get(unit.id)!} --> ${mermaidId.get(target)!}`);
      edges += 1;
    }
  }
  lines.push(...classDefs(modules, colors), "  classDef entry stroke-width:4px", "  classDef unwritten stroke-dasharray:5 3,fill-opacity:0.05", "  classDef selected stroke-width:4px,fill-opacity:0.4");
  const assign = (className: string, members: UnderstandUnit[]): void => {
    if (members.length > 0) lines.push(`  class ${members.map((unit) => mermaidId.get(unit.id)!).join(",")} ${className}`);
  };
  modules.forEach((module, index) => assign(`c${index}`, kept.filter((unit) => unit.module === module)));
  assign("entry", kept.filter((unit) => unit.entryPoint));
  assign("unwritten", kept.filter((unit) => unit.spec === null));
  assign("selected", kept.filter((unit) => unit.id === view.selected));
  return { source: lines.join("\n"), ids, shown: kept.length, matching, edges };
}
