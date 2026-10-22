// The log console of a run: its events with the step each belongs to, a time relative to the
// start of the run, filters (tool calls, steps and status, the model's progress, problems, one
// tool), a search, follow-the-newest, and copy or download of what is shown. The events of the
// model's progress are off by default: the steps panel shows the turn instead.

import { ArrowDownToLine, Copy, Download, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import type { JobRunEvent } from "@/lib/api/job-runs";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryOf, describeProgress, isProblem, type LogCategory, logLine, type Progress, toolOf } from "./run-events";

type Filter = "tool" | "status" | "model" | "log" | "problems";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "tool", label: "Tool calls" },
  { id: "status", label: "Steps & status" },
  { id: "log", label: "Messages" },
  { id: "model", label: "Model progress" },
  { id: "problems", label: "Problems" },
];

const TOOL_COLOR: Record<string, string> = {
  read: "var(--ds-status-blue)",
  ls: "var(--ds-status-cyan)",
  find: "var(--ds-status-teal-dark)",
  grep: "var(--ds-status-purple-light)",
  write: "var(--ds-status-green)",
  edit: "var(--ds-status-orange)",
};

const PAGE = 400;

const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)}:${String(s).padStart(2, "0")}`;
};

function Chip({ label, count, active, onClick, tone }: { label: string; count?: number; active: boolean; onClick: () => void; tone?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[var(--geist-pill-radius)] px-2 text-[11.5px] shadow-border focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
        active ? "bg-hover font-medium text-text" : "text-text-muted hover:bg-hover hover:text-text-secondary",
      )}
    >
      {tone === undefined ? null : <span className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />}
      {label}
      {count === undefined ? null : <span className="tabular-nums text-text-muted">{count}</span>}
    </button>
  );
}

export function RunLog({
  events,
  live,
  runStart,
  stepLabel,
  stepIds,
  stepName,
  onClearStep,
  working,
  now,
}: {
  events: readonly JobRunEvent[];
  live: boolean;
  /** The run's start (ms since the epoch); times in the log are relative to it. */
  runStart: number | undefined;
  /** The label of a step id, for the chip on each line. */
  stepLabel: (id: string | undefined) => string;
  /** When set, only the events of these steps are shown (the selected step and what is below it). */
  stepIds: ReadonlySet<string> | undefined;
  stepName: string | undefined;
  onClearStep: () => void;
  /** The agents that are still working, with what the model reported last (shown under the log). */
  working: ReadonlyArray<{ id: string; label: string; progress: Progress; lastToolAt: string | undefined }>;
  now: number;
}): React.JSX.Element {
  const toast = useToast();
  const [shown, setShown] = useState<ReadonlySet<Filter>>(new Set(["tool", "status", "log"]));
  const [tools, setTools] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const box = useRef<HTMLDivElement | null>(null);

  const inStep = useMemo(() => (stepIds === undefined ? events : events.filter((event) => stepIds.has(event.stepRunId ?? ""))), [events, stepIds]);
  const counts = useMemo(() => {
    const byCategory: Record<LogCategory, number> = { tool: 0, status: 0, log: 0, model: 0 };
    const byTool: Record<string, number> = {};
    let problems = 0;
    for (const event of inStep) {
      byCategory[categoryOf(event)] += 1;
      const tool = toolOf(event);
      if (tool !== undefined) byTool[tool] = (byTool[tool] ?? 0) + 1;
      if (isProblem(event)) problems += 1;
    }
    return { byCategory, byTool, problems };
  }, [inStep]);

  const text = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      inStep.filter((event) => {
        const category = categoryOf(event);
        const problem = isProblem(event);
        // A problem is always worth showing when its chip is on; the other chips pick by kind of line.
        if (!(shown.has(category) || (problem && shown.has("problems")))) return false;
        if (shown.has("problems") && shown.size === 1 && !problem) return false;
        if (category === "tool" && tools.size > 0 && !tools.has(toolOf(event) ?? "")) return false;
        return text === "" || event.message.toLowerCase().includes(text) || stepLabel(event.stepRunId).toLowerCase().includes(text);
      }),
    [inStep, shown, tools, text, stepLabel],
  );
  const rows = visible.slice(-limit);

  useEffect(() => {
    // Follow the newest line without scrolling the page.
    const element = box.current;
    if (follow && element !== null) element.scrollTop = element.scrollHeight;
  }, [rows.length, follow]);

  const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const exportText = (): string => visible.map((event) => logLine(event, stepLabel(event.stepRunId))).join("\n");
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exportText());
      toast.success("Log copied", `${visible.length} lines`);
    } catch (failure) {
      toast.error("Could not copy the log", failure);
    }
  };
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([exportText()], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "run.log";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-muted uppercase">
          {live ? <StatusDot tone="blue" className="size-2 animate-pulse" /> : null}
          {live ? "Live log" : "Log"}
        </h5>
        {stepName === undefined ? null : (
          <button type="button" onClick={onClearStep} className="inline-flex h-6 max-w-48 items-center gap-1.5 rounded-[var(--geist-pill-radius)] bg-hover px-2 text-[11.5px] text-text hover:bg-[var(--color-recessed)] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]" title="Show every step again">
            <span className="truncate">{stepName}</span>
            <span aria-hidden className="text-text-muted">
              ×
            </span>
          </button>
        )}
        <div className="relative ml-auto min-w-40 max-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the log"
            aria-label="Search the log"
            className="h-7 w-full rounded-[var(--geist-radius)] bg-surface pr-2 pl-7 text-[12px] text-text shadow-border placeholder:text-text-muted focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          />
        </div>
        <button type="button" onClick={() => void copy()} aria-label="Copy the shown lines" title="Copy the shown lines" className="rounded-[var(--geist-radius)] p-1.5 text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          <Copy className="size-3.5" />
        </button>
        <button type="button" onClick={download} aria-label="Download the shown lines" title="Download the shown lines" className="rounded-[var(--geist-radius)] p-1.5 text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          <Download className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((filter) => (
          <Chip
            key={filter.id}
            label={filter.label}
            count={filter.id === "problems" ? counts.problems : counts.byCategory[filter.id]}
            active={shown.has(filter.id)}
            onClick={() => setShown(toggle(shown, filter.id))}
            {...(filter.id === "problems" && counts.problems > 0 ? { tone: "var(--ds-status-red)" } : {})}
          />
        ))}
        {shown.has("tool") && Object.keys(counts.byTool).length > 1 ? <span className="mx-1 h-4 w-px bg-hover" aria-hidden /> : null}
        {shown.has("tool") && Object.keys(counts.byTool).length > 1
          ? Object.entries(counts.byTool)
              .sort((a, b) => b[1] - a[1])
              .map(([tool, count]) => <Chip key={tool} label={tool} count={count} active={tools.has(tool)} onClick={() => setTools(toggle(tools, tool))} tone={TOOL_COLOR[tool] ?? "var(--ds-text-muted)"} />)
          : null}
      </div>

      <div className="relative">
        <div
          ref={box}
          onScroll={(event) => {
            const element = event.currentTarget;
            setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
          }}
          className="max-h-[420px] min-h-32 overflow-y-auto rounded-[var(--geist-radius)] bg-surface py-1 font-mono text-[11.5px] leading-[20px] shadow-border [scrollbar-gutter:stable]"
        >
          {visible.length > rows.length ? (
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="w-full py-1 text-center font-sans text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
              {visible.length - rows.length} earlier lines — show more
            </button>
          ) : null}
          {rows.length === 0 ? (
            <p className="px-3 py-4 text-center font-sans text-[12px] text-text-muted">{events.length === 0 ? (live ? "Waiting for events…" : "No events recorded.") : "No line matches the filters."}</p>
          ) : (
            rows.map((event) => <LogRow key={event.id} event={event} runStart={runStart} label={stepLabel(event.stepRunId)} />)
          )}
        </div>
        {follow ? null : (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="absolute right-4 bottom-3 inline-flex h-7 items-center gap-1.5 rounded-[var(--geist-pill-radius)] bg-text px-2.5 font-sans text-[11.5px] text-background shadow-md focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            <ArrowDownToLine className="size-3.5" />
            Latest
          </button>
        )}
      </div>
      {working.length === 0 ? null : (
        <ul className="flex flex-col gap-1 rounded-[var(--geist-radius)] bg-recessed/60 px-2.5 py-1.5" aria-label="Agents working now">
          {working.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-text-secondary">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ds-status-blue)]" />
              <span className="font-medium text-text">{entry.label}</span>
              <span className="tabular-nums">{describeProgress(entry.progress)}</span>
              <span className="text-text-muted">· updated {formatRelative(entry.progress.at, now)}</span>
              {entry.lastToolAt === undefined ? null : <span className="text-text-muted">· last tool call {formatRelative(entry.lastToolAt, now)}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] tabular-nums text-text-muted">
        {visible.length} of {events.length} lines{live ? " · following the run" : ""}
      </p>
    </section>
  );
}

/**
 * What a tool call touched, on one line: a path keeps its file name whole and gives up the
 * folders first (never a break inside a name); a pattern or anything else just truncates.
 */
function ToolTarget({ text }: { text: string }): React.JSX.Element {
  const [target = "", ...pattern] = text.split(" ");
  const slash = target.lastIndexOf("/");
  const extra = pattern.join(" ");
  return (
    <span className="flex min-w-0 flex-1 items-baseline text-text-secondary" title={text}>
      {slash < 0 ? null : <span className="min-w-0 truncate text-text-muted">{target.slice(0, slash + 1)}</span>}
      <span className={cn("shrink-0", slash < 0 && "min-w-0 truncate")}>{target.slice(slash + 1)}</span>
      {extra === "" ? null : <span className="ml-2 min-w-0 truncate text-text-muted">{extra}</span>}
    </span>
  );
}

function LogRow({ event, runStart, label }: { event: JobRunEvent; runStart: number | undefined; label: string }): React.JSX.Element {
  const category = categoryOf(event);
  const tool = toolOf(event);
  const blocked = event.kind === "tool" && event.data["decision"] === "blocked";
  const problem = isProblem(event);
  // A tool line reads "<tool> <path or pattern>"; the tool name becomes a coloured tag.
  const rest = tool !== undefined && event.message.startsWith(tool) ? event.message.slice(tool.length).trimStart() : event.message;
  return (
    <p className={cn("flex gap-2 px-2 py-px hover:bg-hover", problem && "bg-[color-mix(in_srgb,var(--ds-status-red)_10%,transparent)]")} title={new Date(event.at).toLocaleString()}>
      <span className="w-12 shrink-0 text-right text-text-muted tabular-nums">{runStart === undefined ? "" : clock(new Date(event.at).getTime() - runStart)}</span>
      <span className="w-32 shrink-0 truncate font-sans text-[11px] leading-[18px] text-text-muted" title={label}>
        {label}
      </span>
      <span className="w-[4.5rem] shrink-0 truncate font-medium" style={{ color: blocked ? "var(--ds-status-red)" : tool === undefined ? undefined : (TOOL_COLOR[tool] ?? "var(--ds-text-secondary)") }}>
        {category === "tool" && tool !== undefined ? tool : null}
      </span>
      {category === "tool" && tool === "codemode" && !problem ? (
        <span className="min-w-0 flex-1 truncate text-text-secondary" title={rest}>
          {rest === "" ? "script" : rest}
        </span>
      ) : category === "tool" && tool !== undefined && !problem ? (
        <ToolTarget text={rest} />
      ) : (
        <span className={cn("line-clamp-3 min-w-0 flex-1 break-words", category === "status" ? "font-medium text-text" : "text-text-muted", problem && "text-[var(--ds-status-red)]")} title={event.message}>
          {rest}
        </span>
      )}
    </p>
  );
}
