// Building blocks of the telemetry overview (Governance → Telemetry, ADR-0048), after the usage
// pages of LLM observability tools: stat tiles with the change against the previous period and a
// sparkline, a usage chart whose metric you switch (cost, tokens, jobs), and one breakdown table
// by agent or model with the token mix and the cost share in each row. Plain SVG/CSS, like the
// other charts; every mark has a title and the numbers are always written out.

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useState } from "react";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { type Column, DataTable } from "@/components/ui/data-table";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { Chips } from "@/components/ui/tabs";
import type { TelemetryBreakdown, TelemetryDay, TelemetryToolStat } from "@/lib/api/telemetry";
import { agentName, cacheHitRate, dayMetric, formatChange, formatCost, formatMillis, formatRate, formatTokens, niceCeil, successRate, tokenTotal, type UsageMetric, USAGE_METRICS } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

/** The token kinds of a prompt and answer, in the order they stack. */
const TOKEN_KINDS = [
  { key: "inputTokens", label: "New input", color: CHART_COLOR.blue },
  { key: "cacheWriteTokens", label: "Cache write", color: CHART_COLOR.purple },
  { key: "cacheReadTokens", label: "Cache read", color: CHART_COLOR.green },
  { key: "outputTokens", label: "Output", color: CHART_COLOR.orange },
] as const;

/** Whether a rise is good news, bad news, or neither: it sets the colour of a change. */
type Direction = "up-bad" | "up-good" | "neutral";

export function Sparkline({ values, color = CHART_COLOR.blue }: { values: readonly number[]; color?: string }): React.JSX.Element | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${22 - ((value - min) / span) * 20}`);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polygon points={`0,24 ${points.join(" ")} 100,24`} fill={color} fillOpacity={0.1} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function ChangeBadge({ change, direction, label }: { change: number | null; direction: Direction; label?: string }): React.JSX.Element {
  if (change === null) return <span className="text-[11px] text-text-muted">no earlier period</span>;
  const flat = Math.abs(change) < 0.005;
  const bad = !flat && direction !== "neutral" && change > 0 === (direction === "up-bad");
  const good = !flat && direction !== "neutral" && !bad;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums", bad ? "text-[var(--ds-status-red)]" : good ? "text-[var(--ds-status-green-dark)]" : "text-text-muted")} title={label}>
      <Icon className="size-3" />
      {formatChange(change)}
    </span>
  );
}

export interface StatTileProps {
  label: string;
  value: string;
  /** Change against the previous period (a fraction), or null when there is none. */
  change?: number | null;
  direction?: Direction;
  spark?: readonly number[];
  sparkColor?: string;
  hint?: string;
  tone?: StatusTone | undefined;
}

export function StatTile({ label, value, change, direction = "neutral", spark, sparkColor, hint, tone }: StatTileProps): React.JSX.Element {
  return (
    <div className="shadow-border-medium flex min-w-0 flex-col gap-1 rounded-xl bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] tracking-wide text-text-muted uppercase" title={label}>
        {tone === undefined ? null : <StatusDot tone={tone} className="size-2 shrink-0" />}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[24px] leading-7 font-semibold tracking-tight text-text tabular-nums">{value}</p>
        {change === undefined ? null : <ChangeBadge change={change} direction={direction} label="Against the previous period of the same length" />}
      </div>
      {spark === undefined ? null : <Sparkline values={spark} color={sparkColor ?? CHART_COLOR.blue} />}
      {hint === undefined ? null : (
        <p className="line-clamp-2 text-[11px] break-words text-text-muted" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

const CHART = { width: 720, height: 190, left: 46, right: 6, top: 8, bottom: 20 } as const;

const format = (metric: UsageMetric): ((value: number) => string) => (metric === "cost" ? formatCost : formatTokens);

/** Columns per day for one metric: tokens stack by kind, cost and jobs are single bars. */
export function UsageChart({ days, metric }: { days: readonly TelemetryDay[]; metric: UsageMetric }): React.JSX.Element {
  const show = format(metric);
  const top = niceCeil(Math.max(0, ...days.map((day) => dayMetric(day, metric))));
  const plotW = CHART.width - CHART.left - CHART.right;
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const slot = plotW / Math.max(days.length, 1);
  const bar = Math.min(slot * 0.7, 28);
  const y = (value: number): number => CHART.top + plotH - (value / top) * plotH;
  const every = Math.ceil(days.length / 10);
  const title = (day: TelemetryDay): string =>
    `${day.day}: ${day.jobs} jobs, ${formatCost(day.costUsd)}, ${formatTokens(tokenTotal(day))} tokens (${TOKEN_KINDS.map((kind) => `${kind.label.toLowerCase()} ${formatTokens(day[kind.key])}`).join(", ")})`;
  return (
    <div>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="h-auto w-full" role="img" aria-label={`${USAGE_METRICS.find((entry) => entry.id === metric)?.label ?? metric} per day over ${days.length} days, up to ${show(top)}`}>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(top * fraction)} y2={y(top * fraction)} stroke="var(--ds-gray-alpha-400)" strokeWidth={1} />
            <text x={CHART.left - 6} y={y(top * fraction) + 3} textAnchor="end" fontSize={10} fill="var(--ds-text-muted)">
              {show(top * fraction)}
            </text>
          </g>
        ))}
        {days.map((day, index) => {
          const x = CHART.left + index * slot + (slot - bar) / 2;
          let floor = 0;
          const parts =
            metric === "tokens"
              ? TOKEN_KINDS.map((kind) => ({ label: kind.label, value: day[kind.key], color: kind.color }))
              : [{ label: metric === "cost" ? "Cost" : "Jobs", value: dayMetric(day, metric), color: metric === "cost" ? CHART_COLOR.teal : CHART_COLOR.blue }];
          return (
            <g key={day.day}>
              <title>{title(day)}</title>
              <rect x={CHART.left + index * slot} y={CHART.top} width={slot} height={plotH} fill="transparent" />
              {parts.map((part) => {
                if (part.value <= 0) return null;
                const bottom = floor;
                floor += part.value;
                return <rect key={part.label} x={x} width={bar} y={y(floor)} height={Math.max(y(bottom) - y(floor), 1)} fill={part.color} rx={1.5} />;
              })}
              {index % every === 0 ? (
                <text x={x + bar / 2} y={CHART.height - 5} textAnchor="middle" fontSize={10} fill="var(--ds-text-muted)">
                  {day.day.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {metric === "tokens" ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-secondary">
          {TOKEN_KINDS.map((kind) => (
            <li key={kind.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: kind.color }} />
              {kind.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A bar split by token kind, for the mix of one row. */
function TokenMix({ row }: { row: TelemetryBreakdown }): React.JSX.Element {
  const total = tokenTotal(row);
  return (
    <div className="flex h-1.5 w-full min-w-[80px] gap-px overflow-hidden rounded-full bg-hover" title={TOKEN_KINDS.map((kind) => `${kind.label} ${formatTokens(row[kind.key])}`).join(" · ")}>
      {TOKEN_KINDS.map((kind) => (row[kind.key] > 0 ? <span key={kind.key} className="h-full min-w-[2px]" style={{ width: `${(row[kind.key] / total) * 100}%`, backgroundColor: kind.color }} /> : null))}
    </div>
  );
}

type Dimension = "agent" | "model";

/** Spend and tokens by agent or by model: one table, the share of the cost in each row, a click on an agent filters the page. */
export function BreakdownTable({ byAgent, byModel, onAgent }: { byAgent: readonly TelemetryBreakdown[]; byModel: readonly TelemetryBreakdown[]; onAgent: (agent: string) => void }): React.JSX.Element {
  const [dimension, setDimension] = useState<Dimension>("agent");
  const rows = dimension === "agent" ? byAgent : byModel;
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const columns: Column<TelemetryBreakdown>[] = [
    {
      id: "name",
      header: dimension === "agent" ? "Agent" : "Model",
      cell: (row) => (dimension === "agent" ? <span title={row.key}>{agentName(row.key)}</span> : <span className="font-mono text-[12px]">{row.key}</span>),
      sort: (row) => row.key,
      search: (row) => row.key,
    },
    { id: "jobs", header: "Jobs", cell: (row) => row.jobs, sort: (row) => row.jobs, align: "right" },
    {
      id: "success",
      header: "Success",
      cell: (row) => {
        const rate = successRate(row);
        return <span className={cn(rate !== null && rate < 0.9 && "text-[var(--ds-status-orange)]")}>{formatRate(rate)}</span>;
      },
      sort: (row) => successRate(row) ?? -1,
      align: "right",
    },
    {
      id: "tokens",
      header: "Tokens",
      cell: (row) => (
        <div className="flex min-w-[110px] flex-col items-end gap-1">
          <span>{formatTokens(tokenTotal(row))}</span>
          <TokenMix row={row} />
        </div>
      ),
      sort: (row) => tokenTotal(row),
      align: "right",
      title: "New input, cache and output tokens; the bar is their mix",
    },
    { id: "cache", header: "Cached", cell: (row) => formatRate(cacheHitRate(row)), sort: (row) => cacheHitRate(row) ?? -1, align: "right", title: "Share of the prompt read from the cache" },
    {
      id: "cost",
      header: "Cost",
      cell: (row) => (
        <div className="flex min-w-[110px] flex-col items-end gap-1">
          <span>
            {formatCost(row.costUsd)} <span className="text-text-muted">{totalCost === 0 ? "" : `${Math.round((row.costUsd / totalCost) * 100)}%`}</span>
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full" style={{ width: `${totalCost === 0 ? 0 : Math.max((row.costUsd / totalCost) * 100, row.costUsd > 0 ? 1 : 0)}%`, backgroundColor: CHART_COLOR.teal }} />
          </div>
        </div>
      ),
      sort: (row) => row.costUsd,
      align: "right",
      title: "Cost and its share of the total",
    },
    { id: "per-job", header: "Per job", cell: (row) => formatCost(row.jobs === 0 ? 0 : row.costUsd / row.jobs), sort: (row) => (row.jobs === 0 ? 0 : row.costUsd / row.jobs), align: "right" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Chips
        label="Group by"
        options={[
          { id: "agent", label: "By agent" },
          { id: "model", label: "By model" },
        ]}
        value={dimension}
        onChange={setDimension}
      />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        label={dimension === "agent" ? "Usage by agent" : "Usage by model"}
        initialSort={{ id: "cost", desc: true }}
        pageSize={8}
        minWidth={640}
        {...(dimension === "agent" ? { onRowClick: (row: TelemetryBreakdown) => onAgent(row.key) } : {})}
      />
    </div>
  );
}

/** The most called tools with their failure rate and latency. */
export function ToolsTable({ tools }: { tools: readonly TelemetryToolStat[] }): React.JSX.Element {
  const columns: Column<TelemetryToolStat>[] = [
    { id: "tool", header: "Tool", cell: (row) => <span className="font-mono text-[12px]">{row.tool}</span>, sort: (row) => row.tool, search: (row) => row.tool },
    { id: "calls", header: "Calls", cell: (row) => formatTokens(row.calls), sort: (row) => row.calls, align: "right" },
    {
      id: "errors",
      header: "Failed",
      cell: (row) => (row.errors === 0 ? <span className="text-text-muted">0</span> : <span className="text-[var(--ds-status-red)]">{row.errors} · {formatRate(row.errors / row.calls)}</span>),
      sort: (row) => (row.calls === 0 ? 0 : row.errors / row.calls),
      align: "right",
    },
    { id: "p95", header: "p95", cell: (row) => formatMillis(row.p95Ms), sort: (row) => row.p95Ms ?? -1, align: "right", title: "95th percentile latency" },
  ];
  return <DataTable rows={tools} columns={columns} rowKey={(row) => row.tool} label="Tool calls" initialSort={{ id: "calls", desc: true }} pageSize={8} minWidth={360} />;
}
