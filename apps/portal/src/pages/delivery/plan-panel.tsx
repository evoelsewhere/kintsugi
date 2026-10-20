// The AI plan of what to understand next (ADR-0041), above the catalog: an agent read the item graph
// (who calls whom, shared data stores, cycles) and the assessment and proposed batches with a reason
// each. A batch is selected with one click; the run bar then starts it like any selection. Without a
// plan a person asks for one (the plan-understand stage); a plan from before a reassessment says so.

import { CircleAlert, GitFork, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import { agentsApi } from "@/lib/api/agents";
import { type CatalogItem, catalogApi, type ItemStatus, type PlanBatch } from "@/lib/api/catalog";
import { type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import { formatRelative } from "@/lib/format";
import { isActiveStatus, ITEM_STATUS, styleOf } from "@/lib/status";
import { agentProblems } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { formatCount } from "./results/results-format";

const RISK_TONE: Record<PlanBatch["risk"], StatusTone> = { high: "red", medium: "orange", low: "green" };
/** Statuses a person can still start understand on. */
const OPEN: readonly ItemStatus[] = ["not-analysed", "failed", "stale"];

export interface PlanPanelProps {
  projectId: string;
  applicationId: string;
  items: readonly CatalogItem[];
  /** The application's plan-understand runs, newest first. */
  planRuns: readonly JobRunView[];
  canRun: boolean;
  /** Why runtime stages cannot start (no repository), when they cannot. */
  blocked: string | undefined;
  selected: ReadonlySet<string>;
  onSelect(ids: string[]): void;
  /** A planning run was queued or finished: the run list is stale. */
  onRunsChanged(): Promise<void>;
}

/** The planned items of a batch a person can still run, in plan order. */
const selectableOf = (batch: PlanBatch, status: Record<string, ItemStatus>): string[] => batch.items.filter((id) => OPEN.includes(status[id] ?? "retired"));

export function PlanPanel({ projectId, applicationId, items, planRuns, canRun, blocked, selected, onSelect, onRunsChanged }: PlanPanelProps): React.JSX.Element {
  const toast = useToast();
  const latest = planRuns[0];
  const planning = latest !== undefined && isActiveStatus(latest.status);
  // Read again whenever a planning run changes state.
  const version = planRuns.map((run) => `${run.id}:${run.status}:${run.documentWrite?.status ?? ""}`).join(",");
  const view = useLoader(`understand-plan/${projectId}/${applicationId}/${version}`, () => catalogApi.plan(projectId, applicationId));
  // The planner is an agent like the others: without a model bound to it (Settings → Providers) its job fails.
  const stages = useLoader("stages", jobRunsApi.stages);
  const agents = useLoader("agents", agentsApi.list);
  const stage = stages.data?.find((entry) => entry.id === "plan-understand");
  const problems = stage === undefined ? [] : agentProblems(stage, agents.data);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  async function plan(): Promise<void> {
    try {
      await jobRunsApi.runStage(projectId, applicationId, "plan-understand");
      toast.success("Planning queued", "An agent reads the item graph and the assessment and proposes the order. It takes a few minutes.");
      await onRunsChanged();
    } catch (failure) {
      toast.error("Could not queue the planning run", failure);
    }
  }

  const disabled = !canRun ? "Planning needs the jobs.run permission." : (blocked ?? (problems.length > 0 ? `${problems.join("; ")}: bind a model in Settings → Providers` : undefined));
  const planButton = (label: string): React.JSX.Element => (
    <Button size="small" variant={view.data?.plan === null || view.data?.plan === undefined ? "solid" : "ghost"} className={view.data?.plan === null || view.data?.plan === undefined ? undefined : "shadow-border"} disabled={disabled !== undefined || planning} title={disabled} onClick={() => void plan()}>
      <Sparkles className="size-3.5" />
      {planning ? "Generating…" : label}
    </Button>
  );

  if (view.error !== null && view.data === undefined) {
    return (
      <Card>
        <p className="text-[12px] text-text-muted">The AI plan is not available from this server: {view.error}</p>
      </Card>
    );
  }
  if (view.data === undefined) return <Card><p className="text-[12px] text-text-muted">Loading the plan…</p></Card>;

  const { plan: current, stale, status } = view.data;
  const failure = latest?.status === "failed" ? latest.failureReason : undefined;

  if (current === null) {
    return (
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Plan what to understand first</CardTitle>
            <CardDescription>
              An agent reads how the {formatCount(items.length)} items call each other, which data they share and what the assessment found, and proposes batches that read well together, foundations first. Test and generated code is left out.
            </CardDescription>
          </div>
          {planButton("Generate Plan")}
        </CardHeader>
        {planning ? <p className="mt-2 text-[12px] text-text-secondary">Planning: the run started {formatRelative(latest.createdAt)}.</p> : null}
        {problems.length === 0 ? null : <p className="mt-2 text-[12px] text-text-secondary">Before planning: {problems.join("; ")}. Bind a model to the agent in Settings → Providers → Agent model bindings.</p>}
        {failure === undefined ? null : <p className="mt-2 text-[12px] text-[var(--ds-status-red)]">The last planning run failed: {failure}</p>}
      </Card>
    );
  }

  const open = current.batches.filter((batch) => selectableOf(batch, status).length > 0);
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            AI plan
            {stale ? <StatusBadge tone="orange" label="Catalog changed since" title="The application was reassessed after this plan: plan again for an order that fits" /> : null}
          </CardTitle>
          <CardDescription>{current.strategy === "" ? `${current.batches.length} batches over ${current.summary.planned} of ${current.summary.open} open items.` : current.strategy}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {open[0] === undefined ? null : (
            <Button size="small" variant="solid" onClick={() => onSelect(selectableOf(open[0]!, status))}>
              Select batch {open[0].n}
            </Button>
          )}
          {planButton("Plan again")}
        </div>
      </CardHeader>
      {failure === undefined ? null : <p className="mt-2 text-[12px] text-[var(--ds-status-red)]">The last planning run failed: {failure}</p>}
      {problems.length === 0 ? null : <p className="mt-2 text-[12px] text-text-secondary">To plan again: {problems.join("; ")}. Bind a model to the agent in Settings → Providers → Agent model bindings.</p>}
      <ol className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {current.batches.map((batch) => (
          <BatchCard key={batch.n} batch={batch} status={status} byId={byId} selected={selected} onSelect={onSelect} />
        ))}
      </ol>
      {current.leftOut.length === 0 && current.dropped.length === 0 ? null : (
        <p className="mt-3 text-[12px] text-text-muted">
          {current.leftOut.length > 0 ? `${current.leftOut.length} item${current.leftOut.length === 1 ? "" : "s"} left out on purpose (${current.leftOut.slice(0, 3).map((entry) => entry.item).join(", ")}${current.leftOut.length > 3 ? ", …" : ""}). ` : ""}
          {current.dropped.length > 0 ? `${current.dropped.length} proposed item${current.dropped.length === 1 ? "" : "s"} dropped by the check (understood, test or generated, unknown or repeated).` : ""}
        </p>
      )}
    </Card>
  );
}

function BatchCard({ batch, status, byId, selected, onSelect }: { batch: PlanBatch; status: Record<string, ItemStatus>; byId: ReadonlyMap<string, CatalogItem>; selected: ReadonlySet<string>; onSelect(ids: string[]): void }): React.JSX.Element {
  const selectable = selectableOf(batch, status);
  const chosen = selectable.filter((id) => selected.has(id)).length;
  const done = batch.items.length - selectable.length;
  const cohesion = batch.cohesion === null ? undefined : Math.round(batch.cohesion * 100);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-[10px] px-3 py-2.5 shadow-border">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-[11px] font-medium text-text-secondary">{batch.n}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={batch.title}>
          {batch.title}
        </span>
        <StatusBadge tone={RISK_TONE[batch.risk]} label={`${batch.risk} risk`} />
      </div>
      {batch.rationale === "" ? null : <p className="text-[12px] text-text-secondary">{batch.rationale}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {batch.items.map((id) => {
          const item = byId.get(id);
          const state = status[id] ?? "retired";
          return (
            <li key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-hover px-2 py-0.5 text-[11.5px] text-text-secondary" title={`${id} · ${styleOf(ITEM_STATUS, state).label}${item === undefined ? "" : ` · ${formatCount(item.loc)} lines`}`}>
              <StatusDot tone={styleOf(ITEM_STATUS, state).tone} className="size-1.5" />
              <span className="truncate">{item?.name ?? id}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-muted tabular-nums">
        <span>{formatCount(batch.loc)} lines</span>
        {batch.high === 0 ? null : <span>{batch.high} high complexity</span>}
        {cohesion === undefined ? null : (
          <span className="inline-flex items-center gap-1" title="Calls inside the batch over all calls its items make to other items: high means the batch reads on its own">
            <GitFork className="size-3" strokeWidth={1.75} />
            {cohesion}% self-contained
          </span>
        )}
        {done > 0 ? <span>{done} already done or running</span> : null}
      </div>
      {batch.dependsOutside.length === 0 ? null : (
        <p className="flex items-start gap-1.5 text-[11.5px] text-text-secondary">
          <CircleAlert className="mt-0.5 size-3 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
          <span>
            Depends on {batch.dependsOutside.length} item{batch.dependsOutside.length === 1 ? "" : "s"} not understood yet:{" "}
            {batch.dependsOutside
              .slice(0, 3)
              .map((entry) => byId.get(entry.item)?.name ?? entry.item)
              .join(", ")}
            {batch.dependsOutside.length > 3 ? ", …" : ""}
          </span>
        </p>
      )}
      <div className="mt-auto flex items-center justify-end gap-2">
        {selectable.length === 0 ? <span className="text-[11.5px] text-text-muted">Nothing left to run in this batch</span> : null}
        <Button size="small" variant="ghost" className="shadow-border" disabled={selectable.length === 0 || chosen === selectable.length} onClick={() => onSelect(selectable)}>
          {chosen === selectable.length && selectable.length > 0 ? "Selected" : `Select ${selectable.length} item${selectable.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </li>
  );
}
