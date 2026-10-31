// Workflow board — how a plugin works, drawn as an architecture board (ADR-0035): dashed lanes with
// mono caps titles, flat boxes tinted by what they are, arrows between the lanes and a governance
// plane where a person decides. Plain HTML/SVG from the design tokens, so it follows light and dark.
// Everything is drawn from the plugin's own manifests (PluginFlow, PluginLink).

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FlowNode, PluginFlow, PluginFlowStep, PluginLink } from "@/lib/api/plugins";
import { cn } from "@/lib/utils";
import { applicationDir, assessmentDir, DOCUMENT_PATH_TOKENS } from "@kintsugi/domain";
import { type FlowSize, packRows, rowHeight, rowLink } from "./flow-layout";
import { linkLabel } from "./link-label";

/** What a box is. The colors are tinted over the page, so they read on a light and a dark theme. */
const KIND = {
  command: { label: "Command", color: "#2dd4bf" },
  script: { label: "Script · tool", color: "#94a3b8" },
  workflow: { label: "Workflow", color: "#f59e0b" },
  agent: { label: "Agent · reasoning", color: "#ec4899" },
  data: { label: "Reads · writes", color: "#64748b" },
  gate: { label: "Person decides", color: "#818cf8" },
  step: { label: "Harness step", color: "#38bdf8" },
} as const;
type Kind = keyof typeof KIND;

type Tint = React.CSSProperties & { "--c": string };
const tint = (kind: Kind): Tint => ({ "--c": KIND[kind].color });

const BOX =
  "rounded-md border border-[color-mix(in_srgb,var(--c)_60%,transparent)] bg-[color-mix(in_srgb,var(--c)_14%,var(--ds-background-100))] px-3 py-2 text-center text-[13px] leading-snug text-text";

/** One box. A `file` makes it a button that opens the file. */
function Box({ kind, title, subtitle, onOpen, selected, className }: { kind: Kind; title: string; subtitle?: React.ReactNode; onOpen?: () => void; selected?: boolean; className?: string }): React.JSX.Element {
  const content = (
    <>
      <span className="block break-words">{title}</span>
      {subtitle === undefined ? null : <span className="mt-0.5 block text-[11px] text-text-secondary">{subtitle}</span>}
    </>
  );
  const classes = cn(BOX, selected === true && "[box-shadow:0_0_0_2px_var(--c)]", className);
  if (onOpen === undefined) return <div style={tint(kind)} className={classes}>{content}</div>;
  return (
    <button type="button" onClick={onOpen} style={tint(kind)} className={cn(classes, "cursor-pointer hover:bg-[color-mix(in_srgb,var(--c)_24%,var(--ds-background-100))] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]")}>
      {content}
    </button>
  );
}

/** A dashed lane with its mono caps title in the lane's color. */
function Lane({ title, kind, children, className }: { title: string; kind: Kind; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <section style={tint(kind)} aria-label={title} className={cn("rounded-lg border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--c)_70%,transparent)] p-3", className)}>
      <h3 className="mb-2 font-mono text-[11px] tracking-[0.14em] break-words text-[var(--c)] uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ArrowDown({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-text-muted" aria-hidden="true">
      <svg width="12" height="26" viewBox="0 0 12 26" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 0v22M2 17l4 5 4-5" />
      </svg>
      {label === undefined ? null : <span className="text-[11px] italic">{label}</span>}
    </div>
  );
}

function ArrowRight({ label, title, className }: { label?: string; title?: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn("flex shrink-0 flex-col items-center justify-center text-text-muted", className)} aria-hidden="true" title={title}>
      {label === undefined || label === "" ? null : <span className="max-w-28 px-1 text-center text-[10px] italic leading-tight [overflow-wrap:anywhere]">{label}</span>}
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M0 6h22M17 2l5 4-5 4" />
      </svg>
    </div>
  );
}

/** One box of a line, and the link drawn from the box before it: an arrow (with a label), or `false` when the two are not linked. */
interface FlowLineItem {
  key: string;
  node: React.ReactNode;
  link?: { label?: string; title?: string } | false;
}

/** The space between two rows of a wrapped line, where the link from one row to the next turns. */
const ROW_GAP = 28;

type Measured = { width: number; sizes: FlowSize[] };

const sameMeasure = (a: Measured | undefined, b: Measured): boolean =>
  a !== undefined &&
  a.width === b.width &&
  a.sizes.length === b.sizes.length &&
  a.sizes.every((size, index) => {
    const other = b.sizes[index];
    return other !== undefined && size.width === other.width && size.height === other.height && size.arrow === other.arrow;
  });

/**
 * A line of boxes linked by arrows that wraps onto as many rows as its lane needs. Every box and arrow is measured at
 * its own size, which does not depend on the row it lands in; packRows decides the rows, and the boxes, the arrows and
 * the links between rows are placed from those same numbers. Nothing is read back after it moved, so the links always
 * end on their boxes, and a resize only repacks. Before the first measurement (and without a layout engine) the boxes
 * simply flow and wrap.
 */
function FlowLine({ items }: { items: readonly FlowLineItem[] }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const arrows = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  // The items of the latest render, so the measure (and the observer that calls it) outlive a parent that rebuilds them.
  const latest = useRef(items);

  const measure = useCallback(() => {
    const host = hostRef.current;
    if (host === null) return;
    setMeasured((prev) => {
      const sizes = latest.current.map((item, index): FlowSize => {
        const old = prev?.sizes[index];
        const box = boxes.current.get(item.key);
        const arrow = arrows.current.get(item.key);
        return {
          width: box?.offsetWidth ?? old?.width ?? 0,
          height: box?.offsetHeight ?? old?.height ?? 0,
          arrow: index === 0 ? 0 : (arrow?.offsetWidth ?? old?.arrow ?? 0),
        };
      });
      const next = { width: host.clientWidth, sizes };
      return sameMeasure(prev, next) ? prev : next;
    });
  }, []);

  // After every render (sizes do not depend on the layout, so this settles at once) and whenever something resizes.
  useLayoutEffect(() => {
    latest.current = items;
    measure();
  });
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(() => measure());
    observer.current = watcher;
    if (hostRef.current !== null) watcher.observe(hostRef.current);
    for (const element of boxes.current.values()) watcher.observe(element);
    return () => {
      watcher.disconnect();
      observer.current = null;
    };
  }, [measure]);

  // One stable ref for every box and arrow (they say which they are in data attributes), so a render neither detaches
  // nor re-observes them; React 19 calls the returned cleanup when one goes.
  const register = useCallback((element: HTMLElement | null) => {
    if (element === null) return;
    const key = element.dataset["flowKey"] ?? "";
    const isBox = element.dataset["flowPart"] === "box";
    const map = isBox ? boxes.current : arrows.current;
    map.set(key, element);
    if (isBox) observer.current?.observe(element);
    return () => {
      if (map.get(key) === element) map.delete(key);
      observer.current?.unobserve(element);
    };
  }, []);

  const layout = useMemo(() => {
    if (measured === undefined || measured.width <= 0 || measured.sizes.length !== items.length || measured.sizes.some((size) => size.width <= 0)) return undefined;
    const { sizes } = measured;
    const rows = packRows(sizes, measured.width);
    const tops: number[] = [];
    let top = 0;
    for (const row of rows) {
      tops.push(top);
      top += rowHeight(row, sizes) + ROW_GAP;
    }
    const box = new Map<number, { left: number; top: number }>();
    const arrow = new Map<number, { left: number; top: number; height: number }>();
    rows.forEach((row, r) => {
      const height = rowHeight(row, sizes);
      let x = 0;
      row.forEach((index, position) => {
        const size = sizes[index]!;
        if (position > 0) {
          arrow.set(index, { left: x, top: tops[r]!, height });
          x += size.arrow;
        }
        box.set(index, { left: x, top: tops[r]! + (height - size.height) / 2 });
        x += size.width;
      });
    });
    const links = rows.slice(1).flatMap((row, r) => {
      const link = items[row[0]!]?.link;
      if (link === false) return [];
      const drawn = rowLink(rows[r]!, row, sizes, ROW_GAP);
      return drawn === undefined ? [] : [{ ...drawn, top: tops[r]! + rowHeight(rows[r]!, sizes), label: link?.label }];
    });
    return { box, arrow, links, height: Math.max(0, top - ROW_GAP) };
  }, [measured, items]);

  return (
    <div ref={hostRef} className={cn("relative", layout === undefined && "flex flex-wrap items-center gap-y-3")} style={layout === undefined ? undefined : { height: layout.height }}>
      {items.map((item, index) => {
        const box = layout?.box.get(index);
        const arrow = layout?.arrow.get(index);
        return (
          <div key={item.key} className="contents">
            {index === 0 ? null : (
              <div
                ref={register}
                data-flow-key={item.key}
                data-flow-part="arrow"
                className={cn("flex", layout !== undefined && "absolute top-0 left-0", layout !== undefined && arrow === undefined && "invisible")}
                style={arrow === undefined ? undefined : { transform: `translate(${arrow.left}px, ${arrow.top}px)`, height: arrow.height }}
              >
                {item.link === false ? <div className="w-6" /> : <ArrowRight label={item.link?.label} title={item.link?.title} />}
              </div>
            )}
            <div
              ref={register}
              data-flow-key={item.key}
              data-flow-part="box"
              className={cn("flex w-max max-w-full shrink-0", layout !== undefined && "absolute top-0 left-0")}
              style={box === undefined ? undefined : { transform: `translate(${box.left}px, ${box.top}px)` }}
            >
              {item.node}
            </div>
          </div>
        );
      })}
      {layout === undefined || layout.links.length === 0 ? null : (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          {layout.links.map((link, index) => (
            <g key={index} transform={`translate(0 ${link.top})`}>
              <path d={link.path} />
              <path d={link.head} />
              {link.label === undefined || link.label === "" ? null : (
                <text x={link.x} y={link.y - 4} textAnchor="middle" stroke="none" fill="currentColor" fontSize="10" fontStyle="italic">
                  {link.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

/** A document-repo path without the application root or the assessment folder prefix. */
const short = (path: string): string => {
  const assessment = `${assessmentDir(DOCUMENT_PATH_TOKENS.app)}/`;
  const application = `${applicationDir(DOCUMENT_PATH_TOKENS.app)}/`;
  return path.startsWith(assessment) ? path.slice(assessment.length) : path.startsWith(application) ? path.slice(application.length) : path;
};

/** What the colors mean. */
export function WorkflowLegend(): React.JSX.Element {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Legend">
      {(Object.keys(KIND) as Kind[]).map((kind) => (
        <li key={kind} style={tint(kind)} className="rounded-md border border-[color-mix(in_srgb,var(--c)_60%,transparent)] bg-[color-mix(in_srgb,var(--c)_14%,var(--ds-background-100))] px-2.5 py-0.5 text-[12px] text-text">
          {KIND[kind].label}
        </li>
      ))}
    </ul>
  );
}

/** The drawing board: a slightly raised page the lanes sit on. */
function Board({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rounded-xl bg-[var(--ds-background-200)] p-4 shadow-border">{children}</div>;
}

/** The plugin's commands in order, each with what it feeds; the selected one is ringed. */
export function PipelineBoard({ flows, pipeline, selected, onSelect }: { flows: readonly PluginFlow[]; pipeline: readonly PluginLink[]; selected: string; onSelect: (command: string) => void }): React.JSX.Element {
  const feeds = useMemo(() => new Map(flows.map((flow) => [flow.command, pipeline.filter((link) => link.from === flow.command)])), [flows, pipeline]);
  const runtime = flows.filter((flow) => flow.audience === "runtime");
  const rest = flows.filter((flow) => flow.audience !== "runtime");
  const lane = (title: string, items: readonly PluginFlow[]): React.JSX.Element | null =>
    items.length === 0 ? null : (
      <Lane title={title} kind="command">
        <FlowLine
          items={items.map((flow, index): FlowLineItem => {
            const next = feeds.get(flow.command) ?? [];
            const prev = index === 0 ? undefined : items[index - 1];
            const fromPrev = prev === undefined ? undefined : (feeds.get(prev.command) ?? []).find((link) => link.to === flow.command);
            return {
              key: flow.command,
              link: fromPrev === undefined ? false : { label: linkLabel(fromPrev.via), title: fromPrev.via.map(short).join("\n") },
              node: (
                <Box
                  kind="command"
                  title={`/${flow.command}`}
                  selected={flow.command === selected}
                  onOpen={() => onSelect(flow.command)}
                  className="min-w-36"
                  subtitle={
                    <>
                      {flow.gates.length === 0 ? flow.audience : `${flow.audience} · ${flow.gates.length} decision${flow.gates.length === 1 ? "" : "s"}`}
                      {next.length === 0 ? null : <span className="mt-1 block text-[10px] italic">feeds {next.map((link) => `/${link.to}`).join(", ")}</span>}
                    </>
                  }
                />
              ),
            };
          })}
        />
      </Lane>
    );
  return (
    <Board>
      <div className="flex flex-col gap-3">
        {lane("Runs in Kintsugi jobs", runtime)}
        {lane("Driven by members in their harness", rest)}
      </div>
    </Board>
  );
}

/** A declared flow as boxes: steps in a row with arrows, parallel steps stacked in a group, per-item steps in a group of their own. */
function FlowRow({ nodes, flow, onOpenFile }: { nodes: readonly FlowNode[]; flow: PluginFlow; onOpenFile: (path: string) => void }): React.JSX.Element {
  const items = useMemo(() => nodes.map((node, index): FlowLineItem => ({ key: String(index), node: <FlowItem node={node} flow={flow} onOpenFile={onOpenFile} /> })), [nodes, flow, onOpenFile]);
  return <FlowLine items={items} />;
}

/** The same row for a command without a declared flow: its scripts and workflows in the order its text names them. */
function WorkRow({ work, onOpenFile }: { work: readonly PluginFlowStep[]; onOpenFile: (path: string) => void }): React.JSX.Element {
  const items = useMemo(
    () =>
      work.map(
        (step): FlowLineItem => ({
          key: step.name,
          node: (
            <Box
              kind={step.kind === "workflow" ? "workflow" : "script"}
              title={step.name}
              subtitle={step.kind === "workflow" ? (step.agents === undefined ? "workflow" : `workflow · ${step.agents.join(", ")}`) : "script"}
              onOpen={() => onOpenFile(step.path)}
              className="min-w-32"
            />
          ),
        }),
      ),
    [work, onOpenFile],
  );
  return <FlowLine items={items} />;
}

/** What a harness step uses, in a few words: the Kintsugi tool it calls or the skill it follows. */
function stepHint(node: { tool?: string; skill?: string }): string | undefined {
  if (node.tool !== undefined) return `tool · ${node.tool}`;
  if (node.skill !== undefined) return `skill · ${node.skill}`;
  return undefined;
}

function FlowItem({ node, flow, onOpenFile }: { node: FlowNode; flow: PluginFlow; onOpenFile: (path: string) => void }): React.JSX.Element {
  switch (node.kind) {
    case "script":
      return (
        <Box
          kind="script"
          title={node.name}
          subtitle={node.generated === true ? `script written by an agent${node.repair === undefined ? "" : `, fixed once by ${node.repair}`}` : "script"}
          onOpen={node.generated === true ? undefined : () => onOpenFile(`scripts/${node.name}.py`)}
          className="min-w-32"
        />
      );
    case "agent":
      return <Box kind="agent" title={node.name} subtitle={node.label} onOpen={() => onOpenFile(`agents/${node.name}.md`)} className="min-w-32" />;
    case "workflow": {
      const agents = flow.steps.find((step) => step.kind === "workflow" && step.name === node.name)?.agents;
      return <Box kind="workflow" title={node.name} subtitle={agents === undefined ? "workflow" : `workflow · ${agents.join(", ")}`} onOpen={() => onOpenFile(`workflows/${node.name}.js`)} className="min-w-32" />;
    }
    case "gate":
      return <Box kind="gate" title={`✋ ${node.label}`} className="min-w-32 max-w-56" />;
    case "step":
      return <Box kind="step" title={node.label} subtitle={stepHint(node)} className="min-w-32 max-w-56" />;
    case "parallel":
      return (
        <Lane title="In parallel" kind="workflow" className="max-w-[32rem] p-2">
          <div className="flex flex-col gap-2">
            {node.steps.map((step, index) => (
              <FlowItem key={index} node={step} flow={flow} onOpenFile={onOpenFile} />
            ))}
          </div>
        </Lane>
      );
    case "each":
      return (
        <Lane title={`For each ${node.label}`} kind="agent" className="max-w-[32rem] p-2">
          <FlowItem node={node.step} flow={flow} onOpenFile={onOpenFile} />
        </Lane>
      );
  }
}

/** One command end to end: who starts it, what it reads, what runs, what it writes, where a person decides. */
export function CommandBoard({ flow, onOpenFile }: { flow: PluginFlow; onOpenFile: (path: string) => void }): React.JSX.Element {
  const work = useMemo(() => flow.steps.filter((step) => step.kind !== "agent"), [flow]);
  const loose = flow.flow === undefined ? flow.steps.filter((step) => step.kind === "agent") : [];
  const who = flow.audience === "runtime" ? "A person starts it in the portal; Kintsugi runs it as jobs, read-only" : "A member runs it in their own harness; Kintsugi supplies context and ingests the result";
  return (
    <Board>
      <div className={cn("grid gap-4", flow.gates.length > 0 && "lg:grid-cols-[minmax(0,1fr)_14rem]")}>
        <div className="flex min-w-0 flex-col">
          <div style={tint("command")} className={cn(BOX, "text-center")}>
            <span className="font-medium">/{flow.command}</span>
            <span className="ml-2 text-text-secondary">· {who}</span>
          </div>
          <ArrowDown />
          {flow.reads.length === 0 ? null : (
            <>
              <Lane title="Reads" kind="data">
                <div className="flex flex-wrap gap-2">
                  {flow.reads.map((read) => (
                    <Box key={read} kind="data" title={short(read)} className="font-mono text-[12px]" />
                  ))}
                </div>
              </Lane>
              <ArrowDown label="context per run" />
            </>
          )}
          <Lane title="Runs" kind="workflow">
            {flow.flow !== undefined ? (
              <FlowRow nodes={flow.flow} flow={flow} onOpenFile={onOpenFile} />
            ) : work.length === 0 ? (
              <p className="text-[13px] text-text-secondary">The command declares no steps; it is carried out by the person or harness that runs it and starts no script or workflow.</p>
            ) : (
              <WorkRow work={work} onOpenFile={onOpenFile} />
            )}
          </Lane>
          {loose.length === 0 ? null : (
            <>
              <ArrowDown label="reasoning" />
              <Lane title="Agents" kind="agent">
                <div className="flex flex-wrap gap-2">
                  {loose.map((agent) => (
                    <Box key={agent.name} kind="agent" title={agent.name} onOpen={() => onOpenFile(agent.path)} className="min-w-32" />
                  ))}
                </div>
              </Lane>
            </>
          )}
          {flow.writes.length === 0 ? null : (
            <>
              <ArrowDown label="writes" />
              <Lane title="Writes · evidence" kind="data">
                <div className="flex flex-wrap gap-2">
                  {flow.writes.map((write) => (
                    <Box key={write} kind="data" title={short(write)} className="font-mono text-[12px]" />
                  ))}
                </div>
              </Lane>
            </>
          )}
        </div>
        {flow.gates.length === 0 ? null : (
          <Lane title="Governance plane" kind="gate" className="self-stretch">
            <div className="flex flex-col gap-2">
              {flow.gates.map((gate) => (
                <Box key={gate} kind="gate" title={gate} />
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-text-secondary italic">Nothing past a decision runs until the accountable person signs.</p>
          </Lane>
        )}
      </div>
    </Board>
  );
}
