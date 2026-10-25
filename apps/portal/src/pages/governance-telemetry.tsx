// Governance → Telemetry: what runtime agent jobs cost and how they behave (ADR-0048). What needs
// attention comes first, then the summary (tokens, cache hit rate, cost, compactions, tool latency),
// then the attempts that produced it, and a trace per attempt in a detail page. The view is held in the
// URL (window, project, agent, attempts filter, open trace). Needs telemetry.view.

import { Activity, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { ShareBar } from "@/components/results/charts";
import { BreakdownTable, StatTile, ToolsTable, UsageChart } from "@/components/telemetry/telemetry-parts";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { DetailPage } from "@/components/detail-page";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Chips } from "@/components/ui/tabs";
import { telemetryApi, type TelemetryRun, type TelemetrySummary, type Trace, type TraceSpan } from "@/lib/api/telemetry";
import { formatDateTime } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import {
  agentName,
  type Attention,
  attentionOf,
  buildTrace,
  cacheHitRate,
  changeOf,
  contextSeries,
  dailyCacheRate,
  fillDays,
  flattenTrace,
  formatAttribute,
  formatCost,
  formatMillis,
  formatPercentPoint,
  formatRate,
  formatTokens,
  isRunFilter,
  isUsageMetric,
  matchesRunFilter,
  pickRun,
  previousRange,
  problemKeys,
  RUN_FILTERS,
  type RunFilter,
  runKey,
  spanDetail,
  spanLabel,
  successRate,
  tokenTotal,
  type TraceNode,
  USAGE_METRICS,
  type UsageMetric,
  WINDOWS,
  windowRange,
  type WindowId,
} from "@/lib/telemetry";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { formatCount } from "./delivery/results/results-format";
import { Section } from "./delivery/results/results-parts";

const RUN_SAMPLE = 200;

export function TelemetryView({ projectOptions }: { projectOptions: { value: string; label: string; hint?: string }[] }): React.JSX.Element {
  // The view lives in the URL, so a filtered list or an open trace can be linked and survives a reload.
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | undefined>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  const windowId: WindowId = WINDOWS.find((entry) => entry.id === params.get("window"))?.id ?? "7";
  const projectId = params.get("project") ?? "";
  const agent = params.get("agent") ?? "";
  const filterParam = params.get("show");
  const filter: RunFilter = isRunFilter(filterParam) ? filterParam : "all";
  const metricParam = params.get("metric");
  const metric: UsageMetric = isUsageMetric(metricParam) ? metricParam : "cost";
  const traceId = params.get("trace");
  const traceStep = params.get("step");
  const attemptParam = params.get("attempt");
  const traceAttempt = attemptParam !== null && Number.isInteger(Number(attemptParam)) ? Number(attemptParam) : null;

  const range = () => ({ ...windowRange(windowId), ...(projectId === "" ? {} : { projectId }) });
  const summary = useLoader<TelemetrySummary>(`telemetry/summary/${windowId}/${projectId}/${agent}`, () => telemetryApi.summary({ ...range(), ...(agent === "" ? {} : { agent }) }), {
    live: ["telemetry"],
  });
  const previous = useLoader<TelemetrySummary>(`telemetry/previous/${windowId}/${projectId}/${agent}`, () => telemetryApi.summary({ ...previousRange(range()), ...(projectId === "" ? {} : { projectId }), ...(agent === "" ? {} : { agent }) }), {
    live: ["telemetry"],
  });
  const runs = useLoader(`telemetry/runs/${windowId}/${projectId}`, async () => (await telemetryApi.runs({ ...range(), limit: RUN_SAMPLE })).items, { live: ["telemetry"] });

  const agentOptions = useMemo(() => {
    const names = [...new Set([...(runs.data ?? []).map((run) => run.agent), ...(agent === "" ? [] : [agent])])].sort();
    return [{ value: "", label: "All agents" }, ...names.map((name) => ({ value: name, label: agentName(name), hint: name }))];
  }, [runs.data, agent]);
  const ofAgent = useMemo(() => (runs.data ?? []).filter((run) => agent === "" || run.agent === agent), [runs.data, agent]);
  const counts = useMemo(() => new Map(RUN_FILTERS.map((entry) => [entry.id, ofAgent.filter((run) => matchesRunFilter(run, entry.id)).length])), [ofAgent]);
  const shown = useMemo(() => ofAgent.filter((run) => matchesRunFilter(run, filter)), [ofAgent, filter]);

  // The attempt of an open trace: from the list when it is there, else asked for by run id (a link from a run's page may name an older attempt).
  const target = traceId === null ? undefined : { runId: traceId, step: traceStep, attempt: traceAttempt };
  const listed = target === undefined ? undefined : pickRun(runs.data ?? [], target);
  const needsLookup = target !== undefined && listed === undefined && !runs.loading;
  const lookup = useLoader<TelemetryRun | null>(`telemetry/open/${needsLookup ? `${target.runId}/${target.step ?? ""}/${target.attempt ?? ""}` : ""}`, async () => {
    if (!needsLookup) return null;
    const page = await telemetryApi.runs({ ...windowRange("90"), runId: target.runId, limit: 50 });
    return pickRun(page.items, target) ?? null;
  });
  const opened = listed ?? lookup.data ?? undefined;
  const openRun = (run: TelemetryRun): void => update({ trace: run.runId, step: run.stepRunId ?? undefined, attempt: String(run.attempt) });
  const closeRun = (): void => update({ trace: undefined, step: undefined, attempt: undefined });
  const showAttention = (item: Attention): void => {
    update({ show: item.show?.filter === undefined || item.show.filter === "all" ? undefined : item.show.filter, ...(item.show?.agent === undefined ? {} : { agent: item.show.agent }) });
    document.getElementById("telemetry-attempts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-text">Runtime telemetry</h2>
          <p className="text-[12px] text-text-muted">Tokens, prompt-cache reads, cost, compactions and tool latency of agent jobs, against the period before. Counts and names only, never prompts or tool output.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips label="Window" options={WINDOWS.map((entry) => ({ id: entry.id, label: entry.label }))} value={windowId} onChange={(id) => update({ window: id === "7" ? undefined : id })} />
          <div className="w-48">
            <Select size="small" value={projectId} options={projectOptions} onChange={(value) => update({ project: value })} />
          </div>
          <div className="w-48">
            <Select size="small" value={agent} options={agentOptions} onChange={(value) => update({ agent: value })} />
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh the telemetry"
            onClick={() => {
              void summary.reload();
              void previous.reload();
              void runs.reload();
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      <Loaded loader={summary} rows={4}>
        {(data) =>
          data.totals.jobs === 0 ? (
            <EmptyState icon={Activity} title="No agent jobs in this window" description="Spans appear here as runtime jobs run, and are kept for 30 days. Widen the window or pick another project." />
          ) : (
            <SummaryView summary={data} previous={previous.data ?? undefined} metric={metric} onMetric={(next) => update({ metric: next === "cost" ? undefined : next })} onAgent={(key) => update({ agent: key })} onAttention={showAttention} />
          )
        }
      </Loaded>

      <div id="telemetry-attempts" className="scroll-mt-4">
        <Section
          title="Attempts"
          description={`The latest ${RUN_SAMPLE} agent attempts in the window; a retry or a repair run is an attempt of its own. Select one for its trace.`}
          actions={
            <Chips
              label="Attempts shown"
              options={RUN_FILTERS.filter((entry) => entry.id === "all" || entry.id === filter || (counts.get(entry.id) ?? 0) > 0).map((entry) => ({
                id: entry.id,
                label: entry.id === "all" ? entry.label : `${entry.label} · ${counts.get(entry.id) ?? 0}`,
              }))}
              value={filter}
              onChange={(id) => update({ show: id === "all" ? undefined : id })}
            />
          }
        >
          <Loaded loader={runs} rows={5}>
            {() => <RunsTable rows={shown} onOpen={openRun} selected={opened} />}
          </Loaded>
        </Section>
      </div>

      <TracePage open={target !== undefined} run={opened} looking={opened === undefined && (runs.loading || lookup.loading)} onClose={closeRun} />
    </div>
  );
}

function SummaryView({
  summary,
  previous,
  metric,
  onMetric,
  onAgent,
  onAttention,
}: {
  summary: TelemetrySummary;
  previous: TelemetrySummary | undefined;
  metric: UsageMetric;
  onMetric: (metric: UsageMetric) => void;
  onAgent: (agent: string) => void;
  onAttention: (item: Attention) => void;
}): React.JSX.Element {
  const { totals } = summary;
  const before = previous === undefined || previous.totals.jobs === 0 ? undefined : previous.totals;
  const days = fillDays(summary.daily, summary.from, summary.to);
  const reasons = summary.compactionReasons.map((entry) => ({ label: entry.reason, value: entry.count, color: entry.reason === "overflow" ? CHART_COLOR.red : entry.reason === "threshold" ? CHART_COLOR.orange : CHART_COLOR.muted }));
  const tokens = tokenTotal(totals);
  const success = successRate(totals);
  const attention = attentionOf(summary);
  const change = (current: number, earlier: number | null | undefined): number | null => (before === undefined ? null : changeOf(current, earlier));

  return (
    <div className="flex flex-col gap-4">
      {attention.length === 0 ? null : <AttentionList items={attention} onShow={onAttention} />}
      <KpiRow>
        <StatTile label="Spend" value={formatCost(totals.costUsd)} change={change(totals.costUsd, before?.costUsd)} direction="up-bad" spark={days.map((day) => day.costUsd)} sparkColor={CHART_COLOR.teal} hint={totals.jobs === 0 ? undefined : `${formatCost(totals.costUsd / totals.jobs)} per job`} />
        <StatTile label="Tokens" value={formatTokens(tokens)} change={change(tokens, before === undefined ? undefined : tokenTotal(before))} spark={days.map(tokenTotal)} hint={`new in ${formatTokens(totals.inputTokens)} · out ${formatTokens(totals.outputTokens)}`} />
        <StatTile
          label="Jobs"
          value={formatCount(totals.jobs)}
          change={change(totals.jobs, before?.jobs)}
          spark={days.map((day) => day.jobs)}
          tone={totals.failedJobs > 0 ? "orange" : "green"}
          hint={`${formatRate(success)} succeeded · ${formatCount(totals.failedJobs)} failed · ${formatCount(totals.retries)} retries`}
        />
        <StatTile
          label="Cache hit rate"
          value={formatRate(totals.cacheHitRate)}
          change={totals.cacheHitRate === null ? null : change(totals.cacheHitRate, before?.cacheHitRate)}
          direction="up-good"
          spark={dailyCacheRate(days)}
          sparkColor={CHART_COLOR.green}
          tone={totals.cacheHitRate === null ? undefined : totals.cacheHitRate >= 0.5 ? "green" : "orange"}
          hint={`${formatTokens(totals.cacheReadTokens)} read from cache`}
        />
        <StatTile
          label="Compactions"
          value={formatCount(totals.compactions)}
          change={change(totals.compactions, before?.compactions)}
          direction="up-bad"
          tone={totals.overflowFailures > 0 ? "red" : undefined}
          hint={totals.overflowFailures > 0 ? `${formatCount(totals.overflowFailures)} job(s) ran out of context` : "no job ran out of context"}
        />
        <StatTile
          label="Tool latency p95"
          value={formatMillis(totals.toolP95Ms)}
          change={totals.toolP95Ms === null ? null : change(totals.toolP95Ms, before?.toolP95Ms)}
          direction="up-bad"
          hint={`${formatCount(totals.toolCalls)} calls · ${formatCount(totals.toolErrors)} failed · codemode ${formatCount(totals.codemodeCalls)} · MCP ${formatCount(totals.mcpCalls)}`}
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section
          title="Usage per day"
          description={metric === "tokens" ? "Tokens by kind: new input, cache writes, cache reads and output (UTC days)." : metric === "cost" ? "Spend per day (UTC)." : "Agent jobs per day (UTC)."}
          actions={<Chips label="Metric" options={USAGE_METRICS.map((entry) => ({ id: entry.id, label: entry.label }))} value={metric} onChange={onMetric} />}
          className="xl:col-span-3"
        >
          <UsageChart days={days} metric={metric} />
        </Section>
        <Section title="Compactions" description="What started each one: the window filling up, an overflow error, or a manual request." className="xl:col-span-2">
          {reasons.length === 0 ? (
            <p className="text-[12px] text-text-muted">No conversation needed compacting.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <ShareBar segments={reasons} format={formatCount} />
              <p className="text-[12px] text-text-muted">A compaction rewrites the start of the conversation, so the next request cannot read it from the cache. An overflow means the window filled faster than the agent could trim it.</p>
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Spend and tokens" description="Where the spend went. Sort a column; select an agent to filter the page." className="xl:col-span-3">
          <BreakdownTable byAgent={summary.byAgent} byModel={summary.byModel} onAgent={onAgent} />
        </Section>
        <Section title="Tool calls" description="How often each tool ran, how often it failed, and its 95th percentile latency." className="xl:col-span-2">
          <ToolsTable tools={summary.tools} />
        </Section>
      </div>
    </div>
  );
}


function AttentionList({ items, onShow }: { items: readonly Attention[]; onShow: (item: Attention) => void }): React.JSX.Element {
  return (
    <section aria-labelledby="telemetry-attention-title" className="rounded-2xl bg-recessed/55 px-4 py-4 sm:px-5">
      <div>
        <h3 id="telemetry-attention-title" className="text-[14px] font-medium text-text">Needs attention</h3>
        <p className="mt-0.5 text-[12px] text-text-secondary">What stands out in this window, most serious first.</p>
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 hover:bg-hover/60">
            <StatusDot tone={item.tone} className="mt-1.5 size-2 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-text">{item.title}</p>
              <p className="text-[12px] text-text-muted">{item.detail}</p>
            </div>
            {item.show === undefined ? null : (
              <Button size="small" variant="ghost" onClick={() => onShow(item)}>
                Show
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunsTable({ rows, onOpen, selected }: { rows: readonly TelemetryRun[]; onOpen: (run: TelemetryRun) => void; selected: TelemetryRun | undefined }): React.JSX.Element {
  const columns: Column<TelemetryRun>[] = [
    { id: "started", header: "Started", cell: (run) => <span className="whitespace-nowrap">{formatDateTime(run.startedAt)}</span>, sort: (run) => run.startedAt },
    { id: "agent", header: "Agent", cell: (run) => <span title={run.agent}>{agentName(run.agent)}</span>, sort: (run) => run.agent, search: (run) => run.agent },
    { id: "model", header: "Model", cell: (run) => <span className="font-mono text-[12px]">{run.provider}/{run.model}</span>, sort: (run) => `${run.provider}/${run.model}`, search: (run) => `${run.provider}/${run.model}` },
    {
      id: "outcome",
      header: "Outcome",
      cell: (run) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={run.error ?? undefined}>
          <StatusDot tone={run.status === "ok" ? "green" : "red"} className="size-2" />
          {run.outcome}
          {run.attempt > 1 ? <span className="text-text-muted"> · attempt {run.attempt}</span> : null}
        </span>
      ),
      sort: (run) => run.outcome,
      search: (run) => run.outcome,
    },
    { id: "turns", header: "Turns", cell: (run) => formatCount(run.turns), sort: (run) => run.turns, align: "right" },
    { id: "tokens", header: "Tokens", cell: (run) => formatTokens(run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens), sort: (run) => run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens, align: "right", title: "New input, output and cache tokens" },
    { id: "cache", header: "Cached", cell: (run) => formatRate(cacheHitRate(run)), sort: (run) => cacheHitRate(run) ?? -1, align: "right", title: "Share of the prompt read from the cache" },
    { id: "cost", header: "Cost", cell: (run) => formatCost(run.costUsd), sort: (run) => run.costUsd, align: "right" },
    { id: "compactions", header: "Compact", cell: (run) => formatCount(run.compactions), sort: (run) => run.compactions, align: "right", title: "Compactions" },
    { id: "context", header: "Peak", cell: (run) => formatPercentPoint(run.contextPeakPercent), sort: (run) => run.contextPeakPercent ?? -1, align: "right", title: "Highest share of the context window the conversation reached" },
    { id: "duration", header: "Time", cell: (run) => formatMillis(run.durationMs), sort: (run) => run.durationMs, align: "right", className: "whitespace-nowrap" },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={runKey}
      label="Agent attempts"
      searchPlaceholder="Search agent, model or outcome"
      initialSort={{ id: "started", desc: true }}
      pageSize={15}
      minWidth={900}
      onRowClick={onOpen}
      selectedKey={selected === undefined ? undefined : runKey(selected)}
      empty={<EmptyState icon={Activity} title="No attempts" description="No agent job matches these filters." />}
    />
  );
}

function TracePage({ open, run, looking, onClose }: { open: boolean; run: TelemetryRun | undefined; looking: boolean; onClose: () => void }): React.JSX.Element | null {
  const subtitle =
    run === undefined ? undefined : (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono">{run.runId}</span>
        {run.attempt > 1 ? <span>attempt {run.attempt}</span> : null}
        <Link to={deliveryLink({ projectId: run.projectId, applicationId: run.applicationId ?? undefined, runId: run.runId })} className="text-text underline-offset-2 hover:underline">
          Open the run
        </Link>
      </span>
    );
  return (
    <DetailPage open={open} title={run === undefined ? "Trace" : `Trace · ${agentName(run.agent)}`} subtitle={subtitle} onClose={onClose}>
      {run !== undefined ? (
        <TraceBody key={runKey(run)} run={run} />
      ) : looking ? (
        <p className="p-4 text-[13px] text-text-muted">Looking for the attempt…</p>
      ) : (
        <EmptyState icon={Activity} title="No trace for this attempt" description="It may be older than the retention period (30 days), or the run did not call an agent." />
      )}
    </DetailPage>
  );
}

function TraceBody({ run }: { run: TelemetryRun }): React.JSX.Element {
  const trace = useLoader<Trace>(`telemetry/trace/${runKey(run)}`, () => telemetryApi.trace(run.runId, { ...(run.stepRunId === null ? {} : { step: run.stepRunId }), attempt: run.attempt }));
  const tokens = run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Attempt summary" className="rounded-2xl bg-recessed/50 px-5 py-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[12px] font-medium text-text">Attempt summary</p>
          <p className="text-[12px] text-text-muted">
            <span className="break-words font-mono">{run.provider}/{run.model}</span>
            <span className="mx-2" aria-hidden>·</span>
            {formatDateTime(run.startedAt)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
          <TraceMetric label="Outcome" value={run.outcome} hint={run.error ?? undefined} tone={run.status === "ok" ? "green" : "red"} />
          <TraceMetric label="Turns" value={formatCount(run.turns)} hint={formatMillis(run.durationMs)} />
          <TraceMetric label="Tokens" value={formatTokens(tokens)} hint={`in ${formatTokens(run.inputTokens)} · out ${formatTokens(run.outputTokens)}`} />
          <TraceMetric label="Cached" value={formatRate(cacheHitRate(run))} hint={`${formatTokens(run.cacheReadTokens)} read · ${formatTokens(run.cacheWriteTokens)} written`} />
          <TraceMetric label="Cost" value={formatCost(run.costUsd)} />
          <TraceMetric label="Compactions" value={formatCount(run.compactions)} hint={`peak ${formatPercentPoint(run.contextPeakPercent)} of the window`} tone={run.outcome === "context-overflow" ? "red" : undefined} />
        </dl>
      </section>
      <Loaded loader={trace} rows={6}>
        {(data) => (
          <div className="flex flex-col gap-5">
            <ContextChart spans={data.spans} />
            <TraceTree trace={data} />
          </div>
        )}
      </Loaded>
    </div>
  );
}

function TraceMetric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-[21px] leading-7 font-medium tracking-tight text-text tabular-nums">
        {tone === undefined ? null : <StatusDot tone={tone} className="size-2 shrink-0" />}
        <span className="truncate" title={value}>{value}</span>
      </dd>
      {hint === undefined ? null : <p className="mt-0.5 truncate text-[11px] text-text-muted" title={hint}>{hint}</p>}
    </div>
  );
}

const CHART = { width: 960, height: 220, left: 42, right: 16, top: 14, bottom: 28 } as const;

/** How full the context window was after each turn, with the compactions that emptied it. */
function ContextChart({ spans }: { spans: readonly TraceSpan[] }): React.JSX.Element {
  const { points, markers, totalMs } = useMemo(() => contextSeries(spans), [spans]);
  const x = (ms: number): number => CHART.left + (ms / totalMs) * (CHART.width - CHART.left - CHART.right);
  const peak = points.length === 0 ? 0 : Math.round(Math.max(...points.map((point) => point.percent)));
  const scaleMax = Math.min(100, Math.max(5, Math.ceil((peak * 1.2) / 5) * 5));
  const y = (percent: number): number => CHART.top + (1 - Math.min(Math.max(percent, 0), scaleMax) / scaleMax) * (CHART.height - CHART.top - CHART.bottom);
  return (
    <section className="rounded-2xl bg-recessed/40 px-4 py-4 sm:px-5 sm:py-5">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[14px] font-medium text-text">Context use</h3>
          <p className="mt-0.5 text-[12px] text-text-muted">
            {points.length === 0 ? "No per-turn context measurements were recorded." : `Context after each turn${markers.length === 0 ? "" : " · dashed markers show compactions"}`}
          </p>
        </div>
        {points.length === 0 ? null : <p className="text-[12px] text-text-secondary">Peak <span className="ml-1 font-medium text-text tabular-nums">{peak}%</span></p>}
      </header>
      {points.length === 0 ? null : (
        <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" role="img" aria-label={`Context window use over ${points.length} turns, peaking at ${peak}%`} className="mt-4 h-52 w-full overflow-visible">
          {[scaleMax, scaleMax / 2, 0].map((tick) => (
            <g key={tick}>
              <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(tick)} y2={y(tick)} stroke="var(--ds-background-300)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={CHART.left - 8} y={y(tick) + 3} textAnchor="end" fontSize={11} fill="var(--ds-text-muted)">
                {Math.round(tick)}%
              </text>
            </g>
          ))}
          {markers.map((marker, index) => (
            <line key={`${marker.offsetMs}-${index}`} x1={x(marker.offsetMs)} x2={x(marker.offsetMs)} y1={CHART.top} y2={y(0)} stroke={CHART_COLOR.orange} strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke">
              <title>{`Compaction (${marker.reason}) at ${formatMillis(marker.offsetMs)}${marker.tokensBefore === undefined ? "" : `: ${formatTokens(marker.tokensBefore)} → ${formatTokens(marker.tokensAfter)} tokens`}`}</title>
            </line>
          ))}
          {points.length < 2 ? null : (
            <polygon
              points={`${x(points[0]!.offsetMs)},${y(0)} ${points.map((point) => `${x(point.offsetMs)},${y(point.percent)}`).join(" ")} ${x(points[points.length - 1]!.offsetMs)},${y(0)}`}
              fill={CHART_COLOR.blue}
              fillOpacity={0.08}
            />
          )}
          {points.length < 2 ? null : <polyline points={points.map((point) => `${x(point.offsetMs)},${y(point.percent)}`).join(" ")} fill="none" stroke={CHART_COLOR.blue} strokeWidth={2.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {(points.length > 24 ? [] : points).map((point) => (
            <circle key={point.turn} cx={x(point.offsetMs)} cy={y(point.percent)} r={3} fill={CHART_COLOR.blue}>
              <title>{`Turn ${point.turn}: ${Math.round(point.percent)}% of the window`}</title>
            </circle>
          ))}
          <text x={CHART.left} y={CHART.height - 4} fontSize={11} fill="var(--ds-text-muted)">0</text>
          <text x={CHART.width - CHART.right} y={CHART.height - 4} textAnchor="end" fontSize={11} fill="var(--ds-text-muted)">{formatMillis(totalMs)}</text>
        </svg>
      )}
    </section>
  );
}

function TraceTree({ trace }: { trace: Trace }): React.JSX.Element {
  const { roots, totalMs } = useMemo(() => buildTrace(trace.spans), [trace.spans]);
  const problems = useMemo(() => problemKeys(trace.spans), [trace.spans]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // The calls under a turn are folded away until the turn is opened, so a long run reads as its turns.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => {
    const list: TraceNode[] = [];
    const visit = (node: TraceNode): void => {
      if (onlyProblems && !problems.has(node.span.spanId)) return;
      list.push(node);
      if (node.depth === 0 || onlyProblems || unfolded.has(`${node.span.attempt}/${node.span.spanId}`)) for (const child of node.children) visit(child);
    };
    for (const root of roots) visit(root);
    return list;
  }, [roots, onlyProblems, problems, unfolded]);
  const toggle = (set: ReadonlySet<string>, update: (next: ReadonlySet<string>) => void, key: string): void => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    update(next);
  };
  const foldable = useMemo(
    () =>
      flattenTrace(roots)
        .filter((node) => node.depth > 0 && node.children.length > 0)
        .map((node) => `${node.span.attempt}/${node.span.spanId}`),
    [roots],
  );
  const allCallsOpen = foldable.length > 0 && foldable.every((key) => unfolded.has(key));
  const grid = "grid min-w-[760px] grid-cols-[minmax(300px,1.2fr)_minmax(260px,1.6fr)_72px] items-center gap-4";
  const timelineMarks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <section aria-labelledby="trace-timeline-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="trace-timeline-title" className="text-[14px] font-medium text-text">Span timeline</h3>
          <p className="mt-0.5 text-[12px] text-text-muted">{formatCount(trace.spans.length)} spans · nested calls are grouped under each turn.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {foldable.length === 0 ? null : (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[12px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              onClick={() => setUnfolded(allCallsOpen ? new Set() : new Set(foldable))}
            >
              {allCallsOpen ? "Collapse calls" : "Expand all calls"}
            </button>
          )}
          {problems.size === 0 ? null : (
            <Chips
              label="Spans shown"
              options={[
                { id: "all", label: "All" },
                { id: "problems", label: "Failures and their parents" },
              ]}
              value={onlyProblems ? "problems" : "all"}
              onChange={(id) => setOnlyProblems(id === "problems")}
            />
          )}
        </div>
      </div>
      {trace.truncated ? <p className="text-[12px] text-text-muted">Only the first {formatCount(trace.spans.length)} spans are available for this attempt.</p> : null}
      <div className="overflow-x-auto rounded-2xl bg-recessed/40 px-3 py-3 sm:px-4">
        <div className="min-w-[760px]">
          <div className={cn(grid, "px-2 pb-2 text-[10px] tracking-wide text-text-muted uppercase")}>
            <span>Span</span>
            <div className="relative h-5 normal-case tracking-normal" role="group" aria-label="Elapsed time">
              {timelineMarks.map((fraction) => (
                <span
                  key={fraction}
                  className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums"
                  style={{ left: `${fraction * 100}%`, transform: fraction === 0 ? "none" : fraction === 1 ? "translateX(-100%)" : "translateX(-50%)" }}
                >
                  {formatMillis(totalMs * fraction)}
                </span>
              ))}
            </div>
            <span className="text-right">Duration</span>
          </div>
          {rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-text-muted">No spans were recorded for this attempt.</p>
          ) : (
            <ul aria-label="Spans of the attempt" className="flex flex-col gap-0.5">
              {rows.map(({ span, depth, offsetMs, children }) => {
                const detail = spanDetail(span);
                const key = `${span.attempt}/${span.spanId}`;
                const attributes = Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b));
                const expandable = attributes.length > 0 || span.error !== null;
                const open = expanded.has(key);
                const folds = depth > 0 && children.length > 0 && !onlyProblems;
                return (
                  <li key={key} className="rounded-lg px-2 hover:bg-hover/45">
                    <div className={cn(grid, "py-2")}>
                      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: Math.min(depth * 16, 96) }}>
                        {folds ? (
                          <button
                            type="button"
                            aria-expanded={unfolded.has(key)}
                            aria-label={unfolded.has(key) ? `Collapse calls of ${spanLabel(span)}` : `Expand calls of ${spanLabel(span)}`}
                            onClick={() => toggle(unfolded, setUnfolded, key)}
                            className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                          >
                            {unfolded.has(key) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                        ) : (
                          <span className="size-4 shrink-0" aria-hidden />
                        )}
                        <StatusDot tone={span.status === "ok" ? "green" : "red"} className="size-2 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {expandable ? (
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={open ? `Hide details for ${spanLabel(span)}` : `Show details for ${spanLabel(span)}`}
                                onClick={() => toggle(expanded, setExpanded, key)}
                                className={cn("min-w-0 truncate text-left text-[13px] text-text hover:underline underline-offset-2 focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]", depth === 0 && "font-medium")}
                                title={spanLabel(span)}
                              >
                                {spanLabel(span)}
                              </button>
                            ) : (
                              <span className={cn("min-w-0 truncate text-[13px] text-text", depth === 0 && "font-medium")} title={spanLabel(span)}>{spanLabel(span)}</span>
                            )}
                            {folds ? <span className="shrink-0 rounded-full bg-hover px-1.5 py-0.5 text-[10px] text-text-muted tabular-nums">{children.length} calls</span> : null}
                          </div>
                          {detail === "" ? null : <p className="mt-0.5 truncate text-[11px] text-text-muted" title={detail}>{detail}</p>}
                        </div>
                      </div>
                      <div className="relative h-2.5 min-w-0 overflow-hidden rounded-full bg-background/70" title={`${formatMillis(span.durationMs)} from ${formatMillis(offsetMs)}`}>
                        {timelineMarks.slice(1, -1).map((fraction) => <span key={fraction} aria-hidden className="absolute inset-y-0 w-px bg-recessed" style={{ left: `${fraction * 100}%` }} />)}
                        <div
                          className={cn("absolute inset-y-0 rounded-full", span.status === "ok" ? "bg-[var(--ds-status-blue)]" : "bg-[var(--ds-status-red)]")}
                          style={{ left: `${(offsetMs / totalMs) * 100}%`, width: `${Math.max((span.durationMs / totalMs) * 100, 0.65)}%` }}
                        />
                      </div>
                      <span className="text-right text-[12px] text-text-secondary tabular-nums">{formatMillis(span.durationMs)}</span>
                    </div>
                    {open ? (
                      <div className="pb-2" style={{ paddingLeft: Math.min(22 + depth * 16, 118) }}>
                        <div className="rounded-xl bg-background/70 px-3 py-2.5">
                          {span.error === null ? null : <p className="mb-2 break-words font-mono text-[12px] text-text">{span.error}</p>}
                          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                            {attributes.map(([name, value]) => (
                              <div key={name} className="contents">
                                <dt className="text-text-muted">{name}</dt>
                                <dd className="min-w-0 break-words font-mono text-text">{formatAttribute(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
