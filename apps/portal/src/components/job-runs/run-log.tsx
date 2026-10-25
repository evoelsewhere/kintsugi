// Bounded console: exclusive event filters, readable complete lines, explicit follow/pause and export.
import { ArrowDownToLine, Download, Pause, Play, Search, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import type { JobRunEvent } from "@/lib/api/job-runs";
import { cn } from "@/lib/utils";
import { categoryOf, describeProgress, isProblem, logLine, type Progress, toolOf } from "./run-events";
import { CONSOLE_FILTERS, filterRunEvents, type ConsoleFilter } from "./run-model";

const PAGE = 400;
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
interface Props {
  visible: boolean;
  events: readonly JobRunEvent[];
  live: boolean;
  connection: "connecting" | "connected" | "reconnecting" | "ended";
  received: number;
  runStart: number | undefined;
  stepLabel: (id: string | undefined) => string;
  stepIds: ReadonlySet<string> | undefined;
  stepName: string | undefined;
  onClearStep: () => void;
  working: ReadonlyArray<{ id: string; label: string; progress: Progress; lastToolAt: string | undefined }>;
  now: number;
  filter: ConsoleFilter;
  onFilter: (filter: ConsoleFilter) => void;
}
export function RunLog({
  visible: isVisible,
  events,
  live,
  connection,
  received,
  runStart,
  stepLabel,
  stepIds,
  stepName,
  onClearStep,
  working,
  filter,
  onFilter,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState("");
  const [wrap, setWrap] = useState(true);
  const [absolute, setAbsolute] = useState(false);
  const [follow, setFollow] = useState(true);
  const [snapshot, setSnapshot] = useState<{ events: readonly JobRunEvent[]; received: number } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const box = useRef<HTMLDivElement | null>(null);
  const userScrolling = useRef(false);
  const source = snapshot?.events ?? events;
  const inStep = useMemo(
    () => (stepIds === undefined ? source : source.filter((event) => stepIds.has(event.stepRunId ?? ""))),
    [source, stepIds],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        CONSOLE_FILTERS.map((entry) => [
          entry.id,
          inStep.filter(
            (event) =>
              entry.id === "all" ||
              (entry.id === "activity"
                ? categoryOf(event) !== "model"
                : entry.id === "problems"
                  ? isProblem(event)
                  : categoryOf(event) === entry.id),
          ).length,
        ]),
      ),
    [inStep],
  );
  const tools = useMemo(
    () =>
      [
        ...new Set(
          inStep.flatMap((event) => {
            const name = toolOf(event);
            return name === undefined ? [] : [name];
          }),
        ),
      ].sort(),
    [inStep],
  );
  const visible = useMemo(
    () =>
      filterRunEvents(
        source,
        { filter, query, tool: filter === "tool" ? tool : "", ...(stepIds === undefined ? {} : { stepIds }) },
        stepLabel,
      ),
    [source, filter, query, tool, stepIds, stepLabel],
  );
  const rows = visible.slice(-limit);
  const lastId = rows.at(-1)?.id;
  useEffect(() => {
    if (isVisible && follow && box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [lastId, follow, filter, query, stepName, wrap, isVisible]);
  const pause = (): void => {
    setFollow(false);
    if (live) setSnapshot({ events, received });
  };
  const resume = (): void => {
    userScrolling.current = false;
    setSnapshot(null);
    setFollow(true);
  };
  const exportText = visible.map((event) => logLine(event, stepLabel(event.stepRunId))).join("\n");
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([exportText], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "run-console.log";
    link.click();
    URL.revokeObjectURL(url);
  };
  const state =
    connection === "connecting"
      ? "Loading events…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : !live
          ? "Recorded"
          : snapshot === null
            ? "Live"
            : "Paused";
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-3 shadow-border sm:p-4" aria-label="Run console">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone={live ? (connection === "reconnecting" ? "orange" : "blue") : "muted"} className="size-2" />
          <h2 className="text-[14px] font-medium text-text">Console</h2>
          <span className="text-[12px] text-text-secondary">{state}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="small" aria-pressed={wrap} onClick={() => setWrap(!wrap)} title="Toggle line wrapping">
            <WrapText />
            Wrap
          </Button>
          <Button size="small" aria-pressed={absolute} onClick={() => setAbsolute(!absolute)}>
            {absolute ? "Clock time" : "Elapsed time"}
          </Button>
          <CopyButton value={exportText} label="Copy filtered log" iconOnly />
          <Button size="icon" aria-label="Download filtered log" title="Download filtered log" onClick={download}>
            <Download />
          </Button>
        </div>
      </div>
      {stepName === undefined ? null : (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-recessed px-3 py-2 text-[13px] text-text">
          <span className="min-w-0 break-words">
            Step: <strong className="font-medium">{stepName}</strong>
          </span>
          <Button size="icon" aria-label="Clear step filter" onClick={onClearStep}>
            <X />
          </Button>
        </div>
      )}
      <select
        aria-label="Console event type"
        value={filter}
        onChange={(event) => {
          onFilter(event.target.value as ConsoleFilter);
          setLimit(PAGE);
        }}
        className="h-9 rounded-md bg-recessed px-3 text-[13px] text-text shadow-border sm:hidden"
      >
        {CONSOLE_FILTERS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label} · {counts[entry.id] ?? 0}
          </option>
        ))}
      </select>
      <div className="hidden flex-wrap gap-1 sm:flex" role="group" aria-label="Console event type">
        {CONSOLE_FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => {
              onFilter(entry.id);
              setLimit(PAGE);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-[12px] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
              filter === entry.id ? "bg-text text-background" : "text-text-secondary hover:bg-hover",
            )}
          >
            <span>{entry.label}</span>
            <span className={cn("tabular-nums", filter === entry.id ? "text-background/80" : "text-text-muted")}>
              {counts[entry.id] ?? 0}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-text-muted" />
          <Input
            size="small"
            type="search"
            aria-label="Search console"
            placeholder="Search event text or step…"
            className="pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        {filter === "tool" ? (
          <select
            aria-label="Tool filter"
            className="h-8 max-w-full rounded-md bg-surface px-2 text-[12px] text-text shadow-border"
            value={tool}
            onChange={(event) => setTool(event.target.value)}
          >
            <option value="">All tools</option>
            {tools.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="relative min-w-0">
        <div
          ref={box}
          role="log"
          aria-label="Console events"
          aria-live="off"
          tabIndex={0}
          onWheel={() => {
            userScrolling.current = true;
          }}
          onTouchMove={() => {
            userScrolling.current = true;
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) userScrolling.current = true;
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            if (userScrolling.current && follow && element.scrollHeight - element.scrollTop - element.clientHeight > 40) pause();
            userScrolling.current = false;
          }}
          className="h-[min(62vh,660px)] min-h-[360px] overflow-auto rounded-lg bg-recessed/50 p-2 focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] [scrollbar-gutter:stable]"
        >
          {visible.length > rows.length ? (
            <button
              type="button"
              onClick={() => {
                pause();
                setLimit((current) => current + PAGE);
              }}
              className="mb-3 w-full rounded-md bg-surface py-2 text-[12px] text-accent hover:bg-hover"
            >
              Show earlier {Math.min(PAGE, visible.length - rows.length)} events · {visible.length - rows.length} hidden
            </button>
          ) : null}
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="text-[13px] text-text">
                {source.length === 0
                  ? connection === "connecting"
                    ? "Loading recorded events…"
                    : live
                      ? "Waiting for events…"
                      : "No events recorded for this attempt."
                  : "No events match these filters."}
              </p>
              {source.length === 0 ? null : (
                <Button
                  size="small"
                  onClick={() => {
                    setQuery("");
                    setTool("");
                    onFilter("activity");
                    onClearStep();
                  }}
                >
                  Reset console filters
                </Button>
              )}
            </div>
          ) : (
            rows.map((event) => (
              <ConsoleRow
                key={event.id}
                event={event}
                label={stepLabel(event.stepRunId)}
                wrap={wrap}
                time={
                  absolute || runStart === undefined
                    ? new Date(event.at).toLocaleTimeString([], { hour12: false })
                    : elapsed(Date.parse(event.at) - runStart)
                }
              />
            ))
          )}
        </div>
        {!follow ? (
          <Button size="small" variant="solid" className="absolute right-4 bottom-3" onClick={resume}>
            <ArrowDownToLine />
            {live ? `Resume${snapshot === null ? "" : ` · ${Math.max(0, received - snapshot.received)} new`}` : "Jump to latest"}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-secondary">
        <p>
          {rows.length} shown · {visible.length} matching · {source.length} loaded
          {received > events.length ? " · earlier events are outside the loaded window" : ""}
        </p>
        {live ? (
          <Button size="small" onClick={follow ? pause : resume}>
            {follow ? <Pause /> : <Play />}
            {follow ? "Pause updates" : "Resume updates"}
          </Button>
        ) : null}
      </div>
      {working.length === 0 ? null : (
        <ul aria-label="Agents working" className="flex flex-col gap-2 rounded-lg bg-recessed/50 p-3">
          {working.map((entry) => (
            <li key={entry.id} className="text-[12px] text-text-secondary">
              <span className="font-medium text-text">{entry.label}</span>
              <span className="ml-2">{describeProgress(entry.progress)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function ConsoleRow({ event, label, wrap, time }: { event: JobRunEvent; label: string; wrap: boolean; time: string }): React.JSX.Element {
  const problem = isProblem(event);
  const category = categoryOf(event);
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[68px_minmax(0,1fr)] items-start gap-x-3 rounded px-2 py-2 hover:bg-hover md:grid-cols-[68px_130px_72px_minmax(0,1fr)]",
        problem && "bg-surface shadow-border",
      )}
    >
      <time
        dateTime={event.at}
        title={new Date(event.at).toLocaleString()}
        className="pt-0.5 font-mono text-[11px] tabular-nums text-text-muted"
      >
        {time}
      </time>
      <span className="hidden min-w-0 break-words text-[11px] leading-5 text-text-secondary md:block">{label}</span>
      <span className="hidden items-center gap-1.5 pt-0.5 text-[10px] uppercase text-text-secondary md:flex">
        {problem ? <StatusDot tone="red" className="size-1.5 shrink-0" /> : null}
        {toolOf(event) ?? category}
      </span>
      <div className="min-w-0">
        <p className="mb-1 text-[10px] text-text-secondary md:hidden">
          {label} · {toolOf(event) ?? category}
          {problem ? " · problem" : ""}
        </p>
        <p
          className={cn(
            "font-mono text-[12px] leading-5 text-text",
            wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "min-w-max whitespace-pre",
          )}
        >
          {event.message}
        </p>
      </div>
    </div>
  );
}
