// Governance → Telemetry: what runtime agent jobs cost and how they behave (ADR-0048). What needs
// attention comes first, then the summary (tokens, cache hit rate, cost, compactions, tool latency),
// then the attempts that produced it, and a trace per attempt in a drawer. The view is held in the
// URL (window, project, agent, attempts filter, open trace). Needs telemetry.view.

import { Activity, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { BarList, ShareBar, StackedColumns } from "@/components/results/charts";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
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
  contextSeries,
  fillDays,
  flattenTrace,
  formatAttribute,
  formatCost,
  formatMillis,
  formatPercentPoint,
  formatRate,
  formatTokens,
  isRunFilter,
  matchesRunFilter,
  pickRun,
  problemKeys,
  RUN_FILTERS,
  type RunFilter,
  runKey,
  spanDetail,
  spanLabel,
  WINDOWS,
  windowRange,
  type WindowId,
} from "@/lib/telemetry";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { formatCount } from "./delivery/results/results-format";
import { Kpi, KpiRow, Section } from "./delivery/results/results-parts";

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
  const traceId = params.get("trace");
  const traceStep = params.get("step");
  const attemptParam = params.get("attempt");
  const traceAttempt = attemptParam !== null && Number.isInteger(Number(attemptParam)) ? Number(attemptParam) : null;

  const range = () => ({ ...windowRange(windowId), ...(projectId === "" ? {} : { projectId }) });
  const summary = useLoader<TelemetrySummary>(`telemetry/summary/${windowId}/${projectId}/${agent}`, () => telemetryApi.summary({ ...range(), ...(agent === "" ? {} : { agent }) }), {
    refresh: () => 30_000,
  });
  const runs = useLoader(`telemetry/runs/${windowId}/${projectId}`, async () => (await telemetryApi.runs({ ...range(), limit: RUN_SAMPLE })).items, { refresh: () => 30_000 });

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
      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle>Runtime telemetry</CardTitle>
            <CardDescription>What agent jobs spent and how they behaved: tokens, prompt-cache reads, cost, compactions and tool latency. Counts and names only, never prompts or tool output.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chips label="Window" options={WINDOWS.map((entry) => ({ id: entry.id, label: entry.label }))} value={windowId} onChange={(id) => update({ window: id === "7" ? undefined : id })} />
            <div className="w-52">
              <Select value={projectId} options={projectOptions} onChange={(value) => update({ project: value })} />
            </div>
            <div className="w-52">
              <Select value={agent} options={agentOptions} onChange={(value) => update({ agent: value })} />
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh the telemetry"
              onClick={() => {
                void summary.reload();
                void runs.reload();
              }}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Loaded loader={summary} rows={4}>
        {(data) =>
          data.totals.jobs === 0 ? (
            <EmptyState icon={Activity} title="No agent jobs in this window" description="Spans appear here as runtime jobs run, and are kept for 30 days. Widen the window or pick another project." />
          ) : (
            <SummaryView summary={data} onAgent={(key) => update({ agent: key })} onAttention={showAttention} />
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

      <TraceDrawer open={target !== undefined} run={opened} looking={opened === undefined && (runs.loading || lookup.loading)} onClose={closeRun} />
    </div>
  );
}

function SummaryView({ summary, onAgent, onAttention }: { summary: TelemetrySummary; onAgent: (agent: string) => void; onAttention: (item: Attention) => void }): React.JSX.Element {
  const { totals } = summary;
  const days = fillDays(summary.daily, summary.from, summary.to);
  const columns = days.map((day) => ({
    label: day.day.slice(8),
    title: `${day.day}: ${day.jobs} jobs, ${formatTokens(day.inputTokens)} new input, ${formatTokens(day.cacheReadTokens)} cached, ${formatTokens(day.outputTokens)} output, ${formatCost(day.costUsd)}`,
    segments: [
      { label: "New input", value: day.inputTokens, color: CHART_COLOR.blue },
      { label: "Cache write", value: day.cacheWriteTokens, color: CHART_COLOR.purple },
      { label: "Cache read", value: day.cacheReadTokens, color: CHART_COLOR.green },
      { label: "Output", value: day.outputTokens, color: CHART_COLOR.orange },
    ],
  }));
  const reasons = summary.compactionReasons.map((entry) => ({ label: entry.reason, value: entry.count, color: entry.reason === "overflow" ? CHART_COLOR.red : entry.reason === "threshold" ? CHART_COLOR.orange : CHART_COLOR.muted }));
  const tokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens;
  const attention = attentionOf(summary);

  return (
    <div className="flex flex-col gap-4">
      {attention.length === 0 ? null : <AttentionList items={attention} onShow={onAttention} />}
      <KpiRow>
        <Kpi label="Jobs" value={totals.jobs} tone={totals.failedJobs > 0 ? "orange" : "green"} hint={`${formatCount(totals.failedJobs)} failed · ${formatCount(totals.retries)} retries`} />
        <Kpi label="Tokens" value={undefined} display={formatTokens(tokens)} hint={`new in ${formatTokens(totals.inputTokens)} · out ${formatTokens(totals.outputTokens)}`} />
        <Kpi label="Cache hit rate" value={undefined} display={formatRate(totals.cacheHitRate)} hint={`${formatTokens(totals.cacheReadTokens)} read from cache`} tone={totals.cacheHitRate === null ? undefined : totals.cacheHitRate >= 0.5 ? "green" : "orange"} />
        <Kpi label="Cost" value={undefined} display={formatCost(totals.costUsd)} hint={totals.jobs === 0 ? undefined : `${formatCost(totals.costUsd / totals.jobs)} per job`} />
        <Kpi
          label="Compactions"
          value={totals.compactions}
          tone={totals.overflowFailures > 0 ? "red" : undefined}
          hint={totals.overflowFailures > 0 ? `${formatCount(totals.overflowFailures)} job(s) ran out of context` : "no job ran out of context"}
        />
        <Kpi label="Tool latency p95" value={undefined} display={formatMillis(totals.toolP95Ms)} hint={`${formatCount(totals.toolCalls)} calls · ${formatCount(totals.toolErrors)} failed · codemode ${formatCount(totals.codemodeCalls)} · MCP ${formatCount(totals.mcpCalls)}`} />
      </KpiRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Tokens per day" description="New input, cache writes, cache reads and output (UTC days)." className="xl:col-span-3">
          <StackedColumns columns={columns} legend={[{ label: "New input", color: CHART_COLOR.blue }, { label: "Cache write", color: CHART_COLOR.purple }, { label: "Cache read", color: CHART_COLOR.green }, { label: "Output", color: CHART_COLOR.orange }]} />
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Cost by agent" description="Total cost in the window; the note is the cache hit rate. Select an agent to filter the page.">
          <BarList
            format={formatCost}
            color={CHART_COLOR.teal}
            onSelect={(row) => onAgent(row.key)}
            rows={summary.byAgent.slice(0, 8).map((row) => ({ key: row.key, label: agentName(row.key), value: row.costUsd, note: `${formatRate(cacheHitRate(row))} cached`, title: `${row.key}: ${row.jobs} jobs, ${row.failedJobs} failed` }))}
          />
        </Section>
        <Section title="Cost by model" description="Which model the spend went to.">
          <BarList format={formatCost} color={CHART_COLOR.purple} rows={summary.byModel.slice(0, 8).map((row) => ({ key: row.key, label: row.key, value: row.costUsd, note: `${formatCount(row.jobs)} jobs`, mono: true }))} />
        </Section>
        <Section title="Tool calls" description="The most called tools; the note is how many failed and the 95th percentile.">
          <BarList
            format={formatCount}
            rows={summary.tools.slice(0, 8).map((row) => ({ key: row.tool, label: row.tool, value: row.calls, note: `${row.errors > 0 ? `${row.errors} failed · ` : ""}p95 ${formatMillis(row.p95Ms)}`, mono: true }))}
          />
        </Section>
      </div>
    </div>
  );
}

function AttentionList({ items, onShow }: { items: readonly Attention[]; onShow: (item: Attention) => void }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>What stands out in this window, most serious first.</CardDescription>
        </div>
      </CardHeader>
      <ul className="mt-3 flex flex-col divide-y divide-[var(--ds-gray-alpha-400)]">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
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
    </Card>
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

function TraceDrawer({ open, run, looking, onClose }: { open: boolean; run: TelemetryRun | undefined; looking: boolean; onClose: () => void }): React.JSX.Element | null {
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
    <Drawer open={open} title={run === undefined ? "Trace" : `Trace · ${agentName(run.agent)}`} subtitle={subtitle} onClose={onClose} size="wide">
      {run !== undefined ? (
        <TraceBody run={run} />
      ) : looking ? (
        <p className="p-4 text-[13px] text-text-muted">Looking for the attempt…</p>
      ) : (
        <EmptyState icon={Activity} title="No trace for this attempt" description="It may be older than the retention period (30 days), or the run did not call an agent." />
      )}
    </Drawer>
  );
}

function TraceBody({ run }: { run: TelemetryRun }): React.JSX.Element {
  const trace = useLoader<Trace>(`telemetry/trace/${runKey(run)}`, () => telemetryApi.trace(run.runId, { ...(run.stepRunId === null ? {} : { step: run.stepRunId }), attempt: run.attempt }));
  return (
    <div className="flex flex-col gap-4 p-4">
      <KpiRow>
        <Kpi label="Outcome" value={undefined} display={run.outcome} tone={run.status === "ok" ? "green" : "red"} hint={run.error ?? undefined} />
        <Kpi label="Turns" value={run.turns} hint={formatMillis(run.durationMs)} />
        <Kpi label="Tokens" value={undefined} display={formatTokens(run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens)} hint={`in ${formatTokens(run.inputTokens)} · out ${formatTokens(run.outputTokens)}`} />
        <Kpi label="Cached" value={undefined} display={formatRate(cacheHitRate(run))} hint={`${formatTokens(run.cacheReadTokens)} read · ${formatTokens(run.cacheWriteTokens)} written`} />
        <Kpi label="Cost" value={undefined} display={formatCost(run.costUsd)} />
        <Kpi label="Compactions" value={run.compactions} hint={`peak ${formatPercentPoint(run.contextPeakPercent)} of the window`} tone={run.outcome === "context-overflow" ? "red" : undefined} />
      </KpiRow>
      <Loaded loader={trace} rows={6}>
        {(data) => (
          <>
            <ContextChart spans={data.spans} />
            <TraceTree trace={data} />
          </>
        )}
      </Loaded>
    </div>
  );
}

const CHART = { width: 600, height: 112, left: 34, right: 8, top: 8, bottom: 18 } as const;

/** How full the context window was after each turn, with the compactions that emptied it. */
function ContextChart({ spans }: { spans: readonly TraceSpan[] }): React.JSX.Element | null {
  const { points, markers, totalMs } = useMemo(() => contextSeries(spans), [spans]);
  if (points.length === 0) return null;
  const x = (ms: number): number => CHART.left + (ms / totalMs) * (CHART.width - CHART.left - CHART.right);
  const y = (percent: number): number => CHART.top + (1 - Math.min(Math.max(percent, 0), 100) / 100) * (CHART.height - CHART.top - CHART.bottom);
  const peak = Math.round(Math.max(...points.map((point) => point.percent)));
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[12px] font-medium text-text">Context window</h3>
      <p className="text-[12px] text-text-muted">How full the window was after each turn{markers.length === 0 ? "." : "; a dashed line marks a compaction."}</p>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={`Context window use over ${points.length} turns, peaking at ${peak}%`} className="w-full">
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(tick)} y2={y(tick)} stroke="var(--ds-gray-alpha-400)" strokeWidth={1} />
            <text x={CHART.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="var(--ds-text-muted)">
              {tick}%
            </text>
          </g>
        ))}
        {markers.map((marker) => (
          <line key={marker.offsetMs} x1={x(marker.offsetMs)} x2={x(marker.offsetMs)} y1={CHART.top} y2={y(0)} stroke={CHART_COLOR.orange} strokeWidth={1.25} strokeDasharray="3 3">
            <title>{`Compaction (${marker.reason}) at ${formatMillis(marker.offsetMs)}${marker.tokensBefore === undefined ? "" : `: ${formatTokens(marker.tokensBefore)} → ${formatTokens(marker.tokensAfter)} tokens`}`}</title>
          </line>
        ))}
        {points.length < 2 ? null : <polyline points={points.map((point) => `${x(point.offsetMs)},${y(point.percent)}`).join(" ")} fill="none" stroke={CHART_COLOR.blue} strokeWidth={1.75} strokeLinejoin="round" />}
        {points.map((point) => (
          <circle key={point.turn} cx={x(point.offsetMs)} cy={y(point.percent)} r={2.75} fill={CHART_COLOR.blue}>
            <title>{`Turn ${point.turn}: ${Math.round(point.percent)}% of the window`}</title>
          </circle>
        ))}
        <text x={CHART.left} y={CHART.height - 4} fontSize={10} fill="var(--ds-text-muted)">
          0
        </text>
        <text x={CHART.width - CHART.right} y={CHART.height - 4} textAnchor="end" fontSize={10} fill="var(--ds-text-muted)">
          {formatMillis(totalMs)}
        </text>
      </svg>
    </section>
  );
}

function TraceTree({ trace }: { trace: Trace }): React.JSX.Element {
  const { roots, totalMs } = useMemo(() => buildTrace(trace.spans), [trace.spans]);
  const problems = useMemo(() => problemKeys(trace.spans), [trace.spans]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => flattenTrace(roots).filter(({ span }) => !onlyProblems || problems.has(span.spanId)), [roots, onlyProblems, problems]);
  const toggle = (key: string): void =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const grid = "grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_56px] items-center gap-3 py-1.5 text-left text-[13px]";
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-text">Spans</h3>
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
      {trace.truncated ? <p className="text-[12px] text-text-muted">The trace is long: only its first {formatCount(trace.spans.length)} spans are shown.</p> : null}
      <div className="overflow-x-auto">
        <ul aria-label="Spans of the attempt" className="min-w-[620px]">
          {rows.map(({ span, depth, offsetMs }) => {
            const detail = spanDetail(span);
            const key = `${span.attempt}/${span.spanId}`;
            const attributes = Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b));
            const expandable = attributes.length > 0 || span.error !== null;
            const open = expanded.has(key);
            const row = (
              <>
                <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                  <StatusDot tone={span.status === "ok" ? "green" : "red"} className="size-2 shrink-0" />
                  <span className={cn("truncate", span.name === "kintsugi.job" && "font-medium")} title={spanLabel(span)}>
                    {spanLabel(span)}
                  </span>
                </div>
                <span className="truncate text-[12px] text-text-muted" title={detail}>
                  {detail}
                </span>
                <div className="relative h-4 min-w-0" title={`${formatMillis(span.durationMs)} from ${formatMillis(offsetMs)}`}>
                  <div className="absolute inset-y-1 rounded-sm bg-[var(--ds-status-blue)] opacity-70" style={{ left: `${(offsetMs / totalMs) * 100}%`, width: `${Math.max((span.durationMs / totalMs) * 100, 0.6)}%` }} />
                </div>
                <span className="text-right text-[12px] text-text-muted tabular-nums">{formatMillis(span.durationMs)}</span>
              </>
            );
            return (
              <li key={key} className="border-b border-[var(--ds-gray-alpha-400)]">
                {expandable ? (
                  <button type="button" aria-expanded={open} onClick={() => toggle(key)} className={cn(grid, "rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]")}>
                    {row}
                  </button>
                ) : (
                  <div className={grid}>{row}</div>
                )}
                {open ? (
                  <div className="mb-2 rounded-md bg-recessed/60 p-2.5" style={{ marginLeft: depth * 16 + 14 }}>
                    {span.error === null ? null : <p className="mb-2 font-mono text-[12px] break-words text-text">{span.error}</p>}
                    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                      {attributes.map(([name, value]) => (
                        <div key={name} className="contents">
                          <dt className="text-text-muted">{name}</dt>
                          <dd className="min-w-0 font-mono break-words text-text">{formatAttribute(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
