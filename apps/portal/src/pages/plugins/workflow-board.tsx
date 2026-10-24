// Workflow board — how a plugin works, drawn as an architecture board (ADR-0035): dashed lanes with
// mono caps titles, flat boxes tinted by what they are, arrows between the lanes and a governance
// plane where a person decides. Plain HTML/SVG from the design tokens, so it follows light and dark.
// Everything is drawn from the plugin's own manifests (PluginFlow, PluginLink).

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FlowNode, PluginFlow, PluginFlowStep, PluginLink } from "@/lib/api/plugins";
import { cn } from "@/lib/utils";
import { applicationDir, assessmentDir, DOCUMENT_PATH_TOKENS } from "@kintsugi/domain";

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
      <h3 className="mb-2 font-mono text-[11px] tracking-[0.14em] text-[var(--c)] uppercase">{title}</h3>
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

function ArrowRight({ label, className }: { label?: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn("flex shrink-0 flex-col items-center justify-center text-text-muted", className)} aria-hidden="true">
      {label === undefined ? null : <span className="max-w-24 truncate text-[10px] italic">{label}</span>}
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M0 6h22M17 2l5 4-5 4" />
      </svg>
    </div>
  );
}

/** One measured link between two boxes that ended up on different rows: out of the first box's bottom edge, down into the next one's top. */
type Elbow = { x1: number; y1: number; x2: number; y2: number; midY: number };

/** Reads where every neighbouring pair sits: the elbow when the pair fell on two rows, null when it did not. */
function readFlowLinks(host: HTMLDivElement, itemRefs: readonly (HTMLDivElement | null)[], items: readonly unknown[]): Array<Elbow | null> {
  const origin = host.getBoundingClientRect();
  const box = (index: number): DOMRect | null => itemRefs[index]?.lastElementChild?.getBoundingClientRect() ?? null;
  const next: Array<Elbow | null> = [];
  for (let index = 0; index + 1 < items.length; index += 1) {
    const from = box(index);
    const to = box(index + 1);
    if (from === null || to === null || to.top <= from.bottom + 2) {
      next.push(null);
      continue;
    }
    const fromX = from.left + from.width / 2;
    next.push({
      x1: fromX - origin.left,
      y1: from.bottom - origin.top,
      x2: Math.min(Math.max(fromX, to.left + 6), to.right - 6) - origin.left,
      y2: to.top - origin.top,
      midY: (from.bottom + to.top) / 2 - origin.top,
    });
  }
  return next;
}

function sameLinks(a: readonly (Elbow | null)[], b: readonly (Elbow | null)[]): boolean {
  return (
    a.length === b.length &&
    a.every((link, index) => {
      const other = b[index] ?? null;
      if (link === null || other === null) return link === other;
      return link.x1 === other.x1 && link.y1 === other.y1 && link.x2 === other.x2 && link.y2 === other.y2 && link.midY === other.midY;
    })
  );
}

/**
 * How a row of boxes wrapped: one slot per neighbouring pair, holding the elbow when the pair fell
 * on two rows and null when it did not. A wrapped row is pushed under the end of the one above it
 * (see FlowRow), so the elbow is usually a straight drop; the polyline bends only when the two
 * boxes do not line up. Measured after every render — the pushed rows move once the first reading
 * decides where they go — and again whenever anything is resized.
 */
function useFlowLinks(hostRef: { current: HTMLDivElement | null }, itemRefs: { current: Array<HTMLDivElement | null> }, items: readonly unknown[]): readonly (Elbow | null)[] {
  const [links, setLinks] = useState<readonly (Elbow | null)[]>([]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const next = readFlowLinks(host, itemRefs.current, items);
    setLinks((prev) => (sameLinks(prev, next) ? prev : next));
  }, [hostRef, itemRefs, items]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const observer = new ResizeObserver(() => {
      const next = readFlowLinks(host, itemRefs.current, items);
      setLinks((prev) => (sameLinks(prev, next) ? prev : next));
    });
    observer.observe(host);
    for (const item of itemRefs.current) if (item !== null) observer.observe(item);
    return () => observer.disconnect();
  }, [hostRef, itemRefs, items]);
  return links;
}

/** The elbows themselves: one polyline per wrapped pair, in the arrows' own color and weight, tipped with the same head. */
function ElbowLayer({ links }: { links: readonly (Elbow | null)[] }): React.JSX.Element | null {
  const elbows = links.filter((link): link is Elbow => link !== null);
  if (elbows.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      {elbows.map((elbow, index) => (
        <g key={index}>
          <path d={`M ${elbow.x1} ${elbow.y1} V ${elbow.midY} H ${elbow.x2} V ${elbow.y2}`} />
          <path d={`M ${elbow.x2 - 4} ${elbow.y2 - 5} L ${elbow.x2} ${elbow.y2} L ${elbow.x2 + 4} ${elbow.y2 - 5}`} />
        </g>
      ))}
    </svg>
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
        <div className="flex flex-wrap items-center gap-y-3">
          {items.map((flow, index) => {
            const next = feeds.get(flow.command) ?? [];
            const prev = index === 0 ? undefined : items[index - 1];
            const fromPrev = prev === undefined ? undefined : (feeds.get(prev.command) ?? []).find((link) => link.to === flow.command);
            return (
              <div key={flow.command} className="flex items-stretch">
                {prev === undefined ? null : fromPrev === undefined ? <div className="w-6" /> : <ArrowRight label={short(fromPrev.via[0] ?? "").split("/").at(-1)} />}
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
              </div>
            );
          })}
        </div>
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const links = useFlowLinks(hostRef, itemRefs, nodes);
  return (
    <div ref={hostRef} className="relative flex flex-wrap items-center gap-y-3">
      {nodes.map((node, index) => {
        const wrapped = index > 0 && (links[index - 1] ?? null) !== null;
        return (
          <div
            key={index}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={cn("flex items-stretch", wrapped && "ms-auto")}
          >
            {index === 0 ? null : <ArrowRight className={wrapped ? "invisible" : undefined} />}
            <FlowItem node={node} flow={flow} onOpenFile={onOpenFile} />
          </div>
        );
      })}
      <ElbowLayer links={links} />
    </div>
  );
}

/** The same row for a command without a declared flow: its scripts and workflows in the order its text names them. */
function WorkRow({ work, onOpenFile }: { work: readonly PluginFlowStep[]; onOpenFile: (path: string) => void }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const links = useFlowLinks(hostRef, itemRefs, work);
  return (
    <div ref={hostRef} className="relative flex flex-wrap items-center gap-y-3">
      {work.map((step, index) => {
        const wrapped = index > 0 && (links[index - 1] ?? null) !== null;
        return (
          <div
            key={step.name}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={cn("flex items-stretch", wrapped && "ms-auto")}
          >
            {index === 0 ? null : <ArrowRight className={wrapped ? "invisible" : undefined} />}
            <Box
              kind={step.kind === "workflow" ? "workflow" : "script"}
              title={step.name}
              subtitle={step.kind === "workflow" ? (step.agents === undefined ? "workflow" : `workflow · ${step.agents.join(", ")}`) : "script"}
              onOpen={() => onOpenFile(step.path)}
              className="min-w-32"
            />
          </div>
        );
      })}
      <ElbowLayer links={links} />
    </div>
  );
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
        <Lane title="In parallel" kind="workflow" className="p-2">
          <div className="flex flex-col gap-2">
            {node.steps.map((step, index) => (
              <FlowItem key={index} node={step} flow={flow} onOpenFile={onOpenFile} />
            ))}
          </div>
        </Lane>
      );
    case "each":
      return (
        <Lane title={`For each ${node.label}`} kind="agent" className="p-2">
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
