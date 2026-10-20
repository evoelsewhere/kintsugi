// Building blocks of the stage result views: KPI tiles with the change since the previous run,
// section cards, a generic Markdown-table view, severity and priority marks, the output files.

import { ArrowDownRight, ArrowUpRight, FileText } from "lucide-react";
import { InlineText } from "@/components/results/inline-text";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import type { Severity, Table } from "@/lib/api/documents";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatCount, SEVERITY_TONE } from "./results-format";


export interface KpiProps {
  label: string;
  value: number | undefined;
  /** Shown instead of the formatted value. */
  display?: string;
  hint?: string;
  /** The same count in the previous run, when comparing. */
  previous?: number | undefined;
  /** Whether a higher value is worse (findings), for the delta's tone. */
  higherIsWorse?: boolean;
  tone?: StatusTone;
}

export function Kpi({ label, value, display, hint, previous, higherIsWorse = false, tone }: KpiProps): React.JSX.Element {
  const delta = value === undefined || previous === undefined ? undefined : Math.round((value - previous) * 1000) / 1000;
  const worse = delta !== undefined && delta !== 0 && delta > 0 === higherIsWorse;
  return (
    <div className="shadow-border-medium flex min-w-0 flex-col gap-1 rounded-xl bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] tracking-wide text-text-muted uppercase" title={label}>
        {tone === undefined ? null : <StatusDot tone={tone} className="size-2 shrink-0" />}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      <p className="text-[24px] leading-7 font-semibold tracking-tight text-text tabular-nums">{display ?? formatCount(value)}</p>
      {delta === undefined ? (
        hint === undefined ? null : <p className="truncate text-[11px] text-text-muted" title={hint}>{hint}</p>
      ) : (
        <p className={cn("flex items-center gap-0.5 text-[11px] tabular-nums", delta === 0 ? "text-text-muted" : worse ? "text-[var(--ds-status-red)]" : "text-[var(--ds-status-green-dark)]")}>
          {delta === 0 ? "No change" : delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {delta === 0 ? "" : `${delta > 0 ? "+" : ""}${formatCount(delta)} since the previous run`}
        </p>
      )}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

export function Section({ title, description, actions, children, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description === undefined ? null : <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

const asNumber = (text: string): number | undefined => {
  const value = Number(text.replace(/[,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(value) ? value : undefined;
};

/** A GFM table from a document, as a DataTable (sortable, searchable when long). */
export function MarkdownTableView({ table, label, pageSize = 25 }: { table: Table; label: string; pageSize?: number }): React.JSX.Element {
  const columns: Column<{ index: number; cells: string[] }>[] = table.header.map((header, column) => ({
    id: String(column),
    header,
    cell: (row) => <InlineText text={row.cells[column] ?? ""} className={column === 0 ? "text-text" : "text-text-secondary"} />,
    sort: (row) => asNumber(row.cells[column] ?? "") ?? row.cells[column] ?? "",
    search: (row) => row.cells[column] ?? "",
  }));
  const rows = table.rows.map((cells, index) => ({ index, cells }));
  return <DataTable label={label} rows={rows} columns={columns} rowKey={(row) => String(row.index)} pageSize={pageSize} minWidth={560} {...(rows.length > 8 ? { searchPlaceholder: `Search ${label.toLowerCase()}` } : {})} />;
}


export function SeverityMark({ severity }: { severity: Severity | "Unknown" }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text">
      <StatusDot tone={SEVERITY_TONE[severity]} className="size-2" />
      {severity}
    </span>
  );
}

const PRIORITY_TONE: Record<string, StatusTone> = { P0: "red", P1: "orange", P2: "blue" };

export function PriorityMark({ priority }: { priority: string }): React.JSX.Element {
  if (priority === "") return <span className="text-text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-text">
      <StatusDot tone={PRIORITY_TONE[priority] ?? "muted"} className="size-2" />
      {priority}
    </span>
  );
}

const CONFIDENCE_TONE: Record<string, StatusTone> = { High: "green", Medium: "orange", Low: "red" };

export function ConfidenceMark({ confidence }: { confidence: string | undefined }): React.JSX.Element {
  if (confidence === undefined) return <span className="text-text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
      <StatusDot tone={CONFIDENCE_TONE[confidence] ?? "muted"} className="size-2" />
      {confidence}
    </span>
  );
}

/** A count chip, optionally a toggle (summary chips that filter a table). */
export function CountChip({ label, count, active, onClick, tone }: { label: string; count: number; active?: boolean; onClick?: () => void; tone?: StatusTone }): React.JSX.Element {
  const content = (
    <>
      {tone === undefined ? null : <StatusDot tone={tone} className="size-2" />}
      {label}
      <span className="font-medium text-text tabular-nums">{count}</span>
    </>
  );
  const className = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-[var(--geist-pill-radius)] px-2.5 text-[12px] text-text-secondary shadow-border",
    onClick !== undefined && "hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
    active === true && "bg-hover text-text [box-shadow:0_0_0_1px_var(--color-text)]",
  );
  return onClick === undefined ? (
    <span className={className}>{content}</span>
  ) : (
    <button type="button" className={className} aria-pressed={active} onClick={onClick}>
      {content}
    </button>
  );
}

/** A labelled block of a detail drawer; hidden when empty. */
export function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element | null {
  if (children === undefined || children === null || children === "" || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{label}</h4>
      <div className="text-[13px] leading-6 text-text-secondary">{children}</div>
    </section>
  );
}

/** The stage's output files at the ref. */
export function OutputFiles({ files }: { files: Array<{ path: string; size: number }> }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {files.map((file) => (
        <li key={file.path} className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] hover:bg-hover">
          <FileText className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" title={file.path}>
            {file.path}
          </span>
          <span className="w-16 shrink-0 text-right text-[11.5px] tabular-nums text-text-secondary">{formatBytes(file.size)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A row of sub-tabs inside a results view. */
export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number | undefined; hidden?: boolean }>; value: T; onChange: (id: T) => void }): React.JSX.Element {
  return (
    <div role="tablist" aria-label="Result sections" className="flex flex-wrap gap-1 rounded-[10px] bg-recessed/70 p-1 self-start">
      {tabs
        .filter((tab) => tab.hidden !== true)
        .map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] text-text-secondary hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
              tab.id === value && "bg-surface font-medium text-text [box-shadow:var(--ds-shadow-border-small)]",
            )}
          >
            {tab.label}
            {tab.count === undefined ? null : <span className="text-[11px] text-text-muted tabular-nums">{tab.count}</span>}
          </button>
        ))}
    </div>
  );
}

/** A label/value line of a signals list (put several in a <dl>). */
export function Signal({ label, value, note, title }: { label: string; value: string; note?: string | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 [box-shadow:0_1px_0_var(--color-hover)] pb-2 last:pb-0 last:shadow-none" title={title}>
      <dt className="shrink-0 text-text-secondary">{label}</dt>
      <dd className="flex min-w-0 items-baseline justify-end gap-2">
        <span className="shrink-0 font-medium text-text tabular-nums">{value}</span>
        {note === undefined ? null : <span className="min-w-0 truncate text-[11.5px] text-text-muted">{note}</span>}
      </dd>
    </div>
  );
}

export function SignalList({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <dl className="flex flex-col gap-2.5 text-[13px]">{children}</dl>;
}

/** A small text link that switches to another view of the results. */
export function MoreLink({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-[12px] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
      {label} →
    </button>
  );
}

/** A titled distribution inside a card: a caption line and the chart under it. */
export function Distribution({ title, count, children }: { title: string; count?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-text">
        {title}
        {count === undefined ? null : ` · ${count}`}
      </p>
      {children}
    </div>
  );
}
