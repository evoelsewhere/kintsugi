// Governance → Telemetry: what runtime agent jobs cost and how they behave (ADR-0048). The summary
// (tokens, cache hit rate, cost, compactions, tool latency) comes first, then the attempts that
// produced it, and a trace per attempt in a drawer. Needs telemetry.view.

import { Activity, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
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
import { telemetryApi, type TelemetryRun, type TelemetrySummary, type Trace } from "@/lib/api/telemetry";
import { formatDateTime } from "@/lib/format";
import {
  agentName,
  buildTrace,
  cacheHitRate,
  fillDays,
  flattenTrace,
  formatCost,
  formatMillis,
  formatPercentPoint,
  formatRate,
  formatTokens,
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
  const [windowId, setWindowId] = useState<WindowId>("7");
  const [projectId, setProjectId] = useState("");
  const [agent, setAgent] = useState("");
  const [open, setOpen] = useState<TelemetryRun | undefined>(undefined);

  const range = () => ({ ...windowRange(windowId), ...(projectId === "" ? {} : { projectId }) });
  const summary = useLoader<TelemetrySummary>(`telemetry/summary/${windowId}/${projectId}/${agent}`, () => telemetryApi.summary({ ...range(), ...(agent === "" ? {} : { agent }) }), {
    refresh: () => 30_000,
  });
  const runs = useLoader(`telemetry/runs/${windowId}/${projectId}`, async () => (await telemetryApi.runs({ ...range(), limit: RUN_SAMPLE })).items, { refresh: () => 30_000 });

  const agentOptions = useMemo(() => {
    const names = [...new Set([...(runs.data ?? []).map((run) => run.agent), ...(agent === "" ? [] : [agent])])].sort();
    return [{ value: "", label: "All agents" }, ...names.map((name) => ({ value: name, label: agentName(name), hint: name }))];
  }, [runs.data, agent]);
  const shown = useMemo(() => (runs.data ?? []).filter((run) => agent === "" || run.agent === agent), [runs.data, agent]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle>Runtime telemetry</CardTitle>
            <CardDescription>What agent jobs spent and how they behaved: tokens, prompt-cache reads, cost, compactions and tool latency. Counts and names only, never prompts or tool output.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chips label="Window" options={WINDOWS.map((entry) => ({ id: entry.id, label: entry.label }))} value={windowId} onChange={setWindowId} />
            <div className="w-52">
              <Select value={projectId} options={projectOptions} onChange={setProjectId} />
            </div>
            <div className="w-52">
              <Select value={agent} options={agentOptions} onChange={setAgent} />
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
        {(data) => (data.totals.jobs === 0 ? <EmptyState icon={Activity} title="No agent jobs in this window" description="Spans appear here as runtime jobs run, and are kept for 30 days. Widen the window or pick another project." /> : <SummaryView summary={data} />)}
      </Loaded>

      <Section title="Attempts" description={`The latest ${RUN_SAMPLE} agent attempts in the window; a retry or a repair run is an attempt of its own. Select one for its trace.`}>
        <Loaded loader={runs} rows={5}>
          {() => <RunsTable rows={shown} onOpen={setOpen} selected={open} />}
        </Loaded>
      </Section>

      <TraceDrawer run={open} onClose={() => setOpen(undefined)} />
    </div>
  );
}

function SummaryView({ summary }: { summary: TelemetrySummary }): React.JSX.Element {
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

  return (
    <div className="flex flex-col gap-4">
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
          {reasons.length === 0 ? <p className="text-[12px] text-text-muted">No conversation needed compacting.</p> : <ShareBar segments={reasons} format={formatCount} />}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Cost by agent" description="Total cost in the window; the note is the cache hit rate.">
          <BarList
            format={formatCost}
            color={CHART_COLOR.teal}
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
      rowKey={(run) => `${run.runId}/${run.stepRunId ?? ""}/${run.attempt}`}
      label="Agent attempts"
      searchPlaceholder="Search agent, model or outcome"
      initialSort={{ id: "started", desc: true }}
      pageSize={15}
      minWidth={900}
      onRowClick={onOpen}
      selectedKey={selected === undefined ? undefined : `${selected.runId}/${selected.stepRunId ?? ""}/${selected.attempt}`}
      empty={<EmptyState icon={Activity} title="No attempts" description="No agent job matches these filters." />}
    />
  );
}

function TraceDrawer({ run, onClose }: { run: TelemetryRun | undefined; onClose: () => void }): React.JSX.Element | null {
  return (
    <Drawer open={run !== undefined} title={run === undefined ? "Trace" : `Trace · ${agentName(run.agent)}`} subtitle={run === undefined ? undefined : `${run.runId}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}`} onClose={onClose} size="wide">
      {run === undefined ? null : <TraceBody run={run} />}
    </Drawer>
  );
}

function TraceBody({ run }: { run: TelemetryRun }): React.JSX.Element {
  const trace = useLoader<Trace>(`telemetry/trace/${run.runId}/${run.stepRunId ?? ""}/${run.attempt}`, () =>
    telemetryApi.trace(run.runId, { ...(run.stepRunId === null ? {} : { step: run.stepRunId }), attempt: run.attempt }),
  );
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
        {(data) => <TraceTree trace={data} />}
      </Loaded>
    </div>
  );
}

function TraceTree({ trace }: { trace: Trace }): React.JSX.Element {
  const { roots, totalMs } = useMemo(() => buildTrace(trace.spans), [trace.spans]);
  const rows = useMemo(() => flattenTrace(roots), [roots]);
  return (
    <div className="flex flex-col gap-2">
      {trace.truncated ? <p className="text-[12px] text-text-muted">The trace is long: only its first {formatCount(trace.spans.length)} spans are shown.</p> : null}
      <div role="table" aria-label="Spans of the attempt" className="overflow-x-auto">
        <div className="min-w-[620px]">
          {rows.map(({ span, depth, offsetMs }) => {
            const detail = spanDetail(span);
            return (
              <div key={`${span.attempt}/${span.spanId}`} role="row" className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_56px] items-center gap-3 border-b border-[var(--ds-gray-alpha-400)] py-1.5 text-[13px]">
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
