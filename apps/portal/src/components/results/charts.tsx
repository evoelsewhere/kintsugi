// Chart primitives of the result views: a share bar, a donut, ranked bars, a histogram and a
// log-log scatter. Plain SVG/CSS (no chart library), coloured from the status palette so they
// read in light and dark. Every mark carries a title for hover, and the numbers are always
// written next to the marks (colour is never the only carrier).

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CHART_COLOR } from "./chart-colors";

export interface Segment {
  label: string;
  value: number;
  color: string;
  detail?: string;
}

const percent = (value: number, total: number): string => (total === 0 ? "0%" : `${value / total < 0.005 && value > 0 ? "<1" : Math.round((value / total) * 100)}%`);

/** One segmented bar and its legend: how a total splits (languages, severities, priorities). */
export function ShareBar({ segments, format, legend = true }: { segments: Segment[]; format: (value: number) => string; legend?: boolean }): React.JSX.Element {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-hover" role="img" aria-label={shown.map((segment) => `${segment.label} ${percent(segment.value, total)}`).join(", ")}>
        {shown.map((segment) => (
          <span key={segment.label} className="h-full min-w-[3px]" style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }} title={`${segment.label}: ${format(segment.value)} (${percent(segment.value, total)})`} />
        ))}
      </div>
      {legend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-secondary">
          {shown.map((segment) => (
            <li key={segment.label} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
              <span className="font-medium text-text tabular-nums">{format(segment.value)}</span>
              <span className="text-text-muted tabular-nums">{percent(segment.value, total)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A donut of segments with a centre label; the legend lists every segment with its share. */
export function Donut({ segments, format, center, caption }: { segments: Segment[]; format: (value: number) => string; center: string; caption: string }): React.JSX.Element {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const starts = shown.map((_, index) => shown.slice(0, index).reduce((sum, segment) => sum + segment.value, 0));
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox="0 0 140 140" className="size-[148px] shrink-0" role="img" aria-label={shown.map((segment) => `${segment.label} ${percent(segment.value, total)}`).join(", ")}>
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-hover)" strokeWidth="16" />
        {shown.map((segment, index) => {
          const length = (segment.value / total) * circumference;
          return (
            <circle
              key={segment.label}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(length - 1.5, 0.5)} ${circumference}`}
              strokeDashoffset={-((starts[index] ?? 0) / total) * circumference}
              transform="rotate(-90 70 70)"
            >
              <title>{`${segment.label}: ${format(segment.value)} (${percent(segment.value, total)})`}</title>
            </circle>
          );
        })}
        <text x="70" y="68" textAnchor="middle" className="fill-text text-[20px] font-semibold tabular-nums">
          {center}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-text-muted text-[10px]">
          {caption}
        </text>
      </svg>
      <ul className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-[12px]">
        {shown.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="min-w-0 flex-1 truncate text-text-secondary" title={segment.detail}>
              {segment.label}
            </span>
            <span className="text-text tabular-nums">{format(segment.value)}</span>
            <span className="w-9 text-right text-text-muted tabular-nums">{percent(segment.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Shown after the value, muted. */
  note?: string;
  color?: string;
  title?: string;
  mono?: boolean;
}

/** Ranked horizontal bars: label and value on one line, a bar scaled to the largest value below. */
export function BarList({ rows, format, color = CHART_COLOR.blue, onSelect }: { rows: BarRow[]; format: (value: number) => string; color?: string; onSelect?: (row: BarRow) => void }): React.JSX.Element {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0 truncate text-left text-text", row.mono === true ? "font-mono text-[11.5px]" : "text-[12.5px]")} title={row.title ?? row.label}>
                {row.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 text-[12px] tabular-nums">
                <span className="text-text">{format(row.value)}</span>
                {row.note === undefined ? null : <span className="min-w-[72px] text-right text-[11px] text-text-muted">{row.note}</span>}
              </span>
            </span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
              <span className="block h-full rounded-full" style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0)}%`, backgroundColor: row.color ?? color }} />
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {onSelect === undefined ? (
              <div className="flex flex-col gap-1">{body}</div>
            ) : (
              <button type="button" onClick={() => onSelect(row)} className="-mx-1.5 flex w-[calc(100%+12px)] flex-col gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical bars over ordered buckets (a distribution). */
export function Histogram({ buckets, format, color = CHART_COLOR.blue, height = 120 }: { buckets: Array<{ label: string; value: number }>; format: (value: number) => string; color?: string; height?: number }): React.JSX.Element {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  return (
    <div className="flex items-end gap-2" style={{ height: height + 34 }}>
      {buckets.map((bucket) => (
        <div key={bucket.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bucket.label}: ${format(bucket.value)}`}>
          <span className="text-[11px] text-text-secondary tabular-nums">{format(bucket.value)}</span>
          <span className="w-full rounded-t-[4px]" style={{ height: Math.max((bucket.value / max) * height, bucket.value > 0 ? 2 : 0), backgroundColor: color }} />
          <span className="w-full truncate text-center text-[10.5px] text-text-muted">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  color: string;
  title: string;
}

const W = 560;
const H = 260;
const PAD = { left: 44, right: 12, top: 10, bottom: 30 };

/** A log-log scatter (both axes log10 of value+1): outliers stay readable next to the bulk. */
export function Scatter({ points, xLabel, yLabel }: { points: ScatterPoint[]; xLabel: string; yLabel: string }): React.JSX.Element {
  const scale = useMemo(() => {
    const log = (value: number): number => Math.log10(value + 1);
    const xMax = Math.max(1, ...points.map((point) => log(point.x)));
    const yMax = Math.max(1, ...points.map((point) => log(point.y)));
    const xTop = Math.ceil(xMax);
    const yTop = Math.ceil(yMax);
    return {
      xTop,
      yTop,
      x: (value: number): number => PAD.left + (log(value) / xTop) * (W - PAD.left - PAD.right),
      y: (value: number): number => H - PAD.bottom - (log(value) / yTop) * (H - PAD.top - PAD.bottom),
    };
  }, [points]);
  const ticks = (top: number): number[] => Array.from({ length: top + 1 }, (_, index) => index);
  // The gridline at power p is the value 10^p − 1, labelled with the round number next to it.
  const tickText = (power: number): string => (power === 0 ? "0" : 10 ** power >= 1000 ? `${10 ** power / 1000}k` : String(10 ** power));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${yLabel} against ${xLabel}, one dot per file`}>
      {ticks(scale.yTop).map((power) => {
        const y = H - PAD.bottom - (power / scale.yTop) * (H - PAD.top - PAD.bottom);
        return (
          <g key={`y${power}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--color-hover)" />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" className="fill-text-muted text-[10px]">
              {tickText(power)}
            </text>
          </g>
        );
      })}
      {ticks(scale.xTop).map((power) => {
        const x = PAD.left + (power / scale.xTop) * (W - PAD.left - PAD.right);
        return (
          <g key={`x${power}`}>
            <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-hover)" />
            <text x={x} y={H - PAD.bottom + 14} textAnchor="middle" className="fill-text-muted text-[10px]">
              {tickText(power)}
            </text>
          </g>
        );
      })}
      <text x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle" className="fill-text-secondary text-[10.5px]">
        {xLabel}
      </text>
      <text x={10} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle" transform={`rotate(-90 10 ${(PAD.top + H - PAD.bottom) / 2})`} className="fill-text-secondary text-[10.5px]">
        {yLabel}
      </text>
      {points.map((point) => (
        <circle key={point.key} cx={scale.x(point.x)} cy={scale.y(point.y)} r="3.2" fill={point.color} fillOpacity="0.55" stroke={point.color} strokeOpacity="0.9" strokeWidth="0.75">
          <title>{point.title}</title>
        </circle>
      ))}
    </svg>
  );
}

/** A table of counts whose cells darken with the value (two dimensions at once, e.g. category by priority). */
export function Heatmap({ rows, columns, values, color = CHART_COLOR.blue }: { rows: string[]; columns: string[]; values: number[][]; color?: string }): React.JSX.Element {
  const max = Math.max(1, ...values.flat());
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column} className="px-1 text-center text-[11px] font-normal text-text-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, y) => (
            <tr key={row}>
              <th className="max-w-[160px] truncate pr-2 text-left text-[12px] font-normal text-text-secondary" title={row}>
                {row}
              </th>
              {columns.map((column, x) => {
                const value = values[y]?.[x] ?? 0;
                return (
                  <td key={column} title={`${row} · ${column}: ${value}`} className="h-7 min-w-9 rounded-[5px] text-center tabular-nums" style={{ backgroundColor: value === 0 ? "var(--color-hover)" : `color-mix(in srgb, ${color} ${Math.round(18 + (value / max) * 62)}%, transparent)` }}>
                    <span className={value === 0 ? "text-text-muted" : "font-medium text-text"}>{value}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
