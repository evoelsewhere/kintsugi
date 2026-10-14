// Workflow board — how a plugin works, drawn as an architecture board (ADR-0035): dashed lanes with
// mono caps titles, flat boxes tinted by what they are, arrows between the lanes and a governance
// plane where a person decides. Plain HTML/SVG from the design tokens, so it follows light and dark.
// Everything is drawn from the plugin's own manifests (PluginFlow, PluginLink).

import { useMemo } from "react";
import type { FlowNode, PluginFlow, PluginLink } from "@/lib/api/plugins";
import { cn } from "@/lib/utils";

/** What a box is. The colors are tinted over the page, so they read on a light and a dark theme. */
const KIND = {
  command: { label: "Command", color: "#2dd4bf" },
  script: { label: "Script · tool", color: "#94a3b8" },
  workflow: { label: "Workflow", color: "#f59e0b" },
  agent: { label: "Agent · reasoning", color: "#ec4899" },
  data: { label: "Reads · writes", color: "#64748b" },
  gate: { label: "Person decides", color: "#818cf8" },
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

function ArrowRight({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center text-text-muted" aria-hidden="true">
      {label === undefined ? null : <span className="max-w-24 truncate text-[10px] italic">{label}</span>}
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M0 6h22M17 2l5 4-5 4" />
      </svg>
    </div>
  );
}

const short = (path: string): string => path.replace("assessment/", "").replace("<app>/", "");

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
        <div className="flex flex-wrap items-stretch gap-y-3">
          {items.map((flow, index) => {
            const next = feeds.get(flow.command) ?? [];
            const linkedToNext = index < items.length - 1 && next.some((link) => link.to === items[index + 1]!.command);
            return (
              <div key={flow.command} className="flex items-stretch">
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
                {index < items.length - 1 ? linkedToNext ? <ArrowRight label={short(next.find((link) => link.to === items[index + 1]!.command)!.via[0] ?? "").split("/").at(-1)} /> : <div className="w-6" /> : null}
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
  return (
    <div className="flex flex-wrap items-stretch gap-y-3">
      {nodes.map((node, index) => (
        <div key={index} className="flex items-stretch">
          <FlowItem node={node} flow={flow} onOpenFile={onOpenFile} />
          {index < nodes.length - 1 ? <ArrowRight /> : null}
        </div>
      ))}
    </div>
  );
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
  const work = flow.steps.filter((step) => step.kind !== "agent");
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
              <p className="text-[13px] text-text-secondary">The command is carried out by the person or harness that runs it; it starts no script or workflow.</p>
            ) : (
              <div className="flex flex-wrap items-stretch gap-y-3">
                {work.map((step, index) => (
                  <div key={step.name} className="flex items-stretch">
                    <Box
                      kind={step.kind === "workflow" ? "workflow" : "script"}
                      title={step.name}
                      subtitle={step.kind === "workflow" ? (step.agents === undefined ? "workflow" : `workflow · ${step.agents.join(", ")}`) : "script"}
                      onOpen={() => onOpenFile(step.path)}
                      className="min-w-32"
                    />
                    {index < work.length - 1 ? <ArrowRight /> : null}
                  </div>
                ))}
              </div>
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
