// The live record of one run as data: the events followed over Server-Sent Events, what kind of
// line each is, and what the events say about each step (tools used, the model's turn, the last
// thing it did). Shared by the steps panel and the log console of a run.

import { useEffect, useRef, useState } from "react";
import { type JobRunEvent, type JobRunView, jobRunsApi } from "@/lib/api/job-runs";

/** Lines kept in memory; the log keeps the newest. */
const MAX_EVENTS = 3000;

/** The events of a run, replayed from the start and then as the worker records them. */
export function useRunEvents(
  projectId: string,
  runId: string,
  handlers: { onStatus: () => void; onStep?: (() => void) | undefined; attempt?: number; stepIds?: ReadonlySet<string> },
): { events: JobRunEvent[]; live: boolean; connection: "connecting" | "connected" | "reconnecting" | "ended"; received: number } {
  const attempt = handlers.attempt;
  const stepIds = handlers.stepIds;
  const stepKey = stepIds === undefined ? "all" : [...stepIds].sort().join(",");
  const key = `${projectId}/${runId}/${attempt ?? "all"}/${stepKey}`;
  const [state, setState] = useState<{
    key: string;
    events: JobRunEvent[];
    live: boolean;
    connection: "connecting" | "connected" | "reconnecting" | "ended";
    received: number;
  }>({ key, events: [], live: true, connection: "connecting", received: 0 });
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    let first = true;
    let lastId = 0n;
    const close = jobRunsApi.follow(projectId, runId, {
      onEvent: (event) => {
        if (attempt !== undefined && event.attempt !== undefined && event.attempt !== attempt) return;
        if (stepIds !== undefined && !stepIds.has(event.stepRunId ?? "")) return;
        if (/^\d+$/.test(event.id)) {
          const id = BigInt(event.id);
          if (id <= lastId) return;
          lastId = id;
        }
        setState((previous) => {
          const current = previous.key === key ? previous : { key, events: [], live: true, connection: "connected" as const, received: 0 };
          return { ...current, events: [...current.events, event].slice(-MAX_EVENTS), received: current.received + 1 };
        });
        if (event.kind === "step.started" || event.kind === "step.finished") latest.current.onStep?.();
      },
      onStatus: () => {
        if (!first) latest.current.onStatus();
        first = false;
      },
      onConnection: (connection) =>
        setState((current) =>
          current.key === key ? { ...current, connection } : { key, events: [], live: true, connection, received: 0 },
        ),
      onEnd: () => {
        setState((current) =>
          current.key === key
            ? { ...current, live: false, connection: "ended" }
            : { key, events: [], live: false, connection: "ended", received: 0 },
        );
        if (!first) latest.current.onStatus();
      },
    });
    return close;
  }, [projectId, runId, key, attempt, stepIds]);
  return state.key === key ? state : { events: [], live: true, connection: "connecting", received: 0 };
}

/**
 * A counter that goes up when a step of the run starts or finishes or its status changes, from the same event stream and
 * without keeping the events: put it in a loader's key to read the run again then, instead of polling. The recorded
 * events replay in a burst when the stream opens, so changes within `SETTLE_MS` count once. Idle while `enabled` is false.
 */
export function useRunPulse(projectId: string, runId: string, enabled: boolean): number {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => setPulse((count) => count + 1), SETTLE_MS);
    };
    const close = jobRunsApi.follow(projectId, runId, {
      onEvent: (event) => {
        if (event.kind === "step.started" || event.kind === "step.finished") changed();
      },
      onStatus: changed,
      onEnd: changed,
    });
    return () => {
      clearTimeout(timer);
      close();
    };
  }, [projectId, runId, enabled]);
  return pulse;
}

const SETTLE_MS = 600;

export type LogCategory = "tool" | "model" | "status" | "log";

export const categoryOf = (event: JobRunEvent): LogCategory =>
  event.kind === "tool"
    ? "tool"
    : event.kind === "status" || event.kind === "step.started" || event.kind === "step.finished"
      ? "status"
      : typeof event.data["turn"] === "number"
        ? "model"
        : "log";

/** The kernel tool a tool event is about (`read`, `grep`, …). */
export const toolOf = (event: JobRunEvent): string | undefined => (typeof event.data["tool"] === "string" ? event.data["tool"] : undefined);

/** A blocked tool call, a failed or cancelled run or step, a stalled agent. */
export const isProblem = (event: JobRunEvent): boolean =>
  (event.kind === "tool" && event.data["decision"] === "blocked") ||
  ((event.kind === "status" || event.kind === "step.finished") &&
    (event.data["status"] === "failed" || event.data["status"] === "cancelled")) ||
  (event.kind === "log" && /\b(stalled|failed)\b/i.test(event.message));

/** What the model reported last: the turn and how much it has thought, argued and written so far. */
export interface Progress {
  turn: number;
  thinkingChars: number;
  toolArgsChars: number;
  textChars: number;
  at: string;
}

export interface StepStats {
  tools: Record<string, number>;
  total: number;
  blocked: number;
  /** The newest model turn the step reported. */
  turn?: number;
  /** The newest model progress report. */
  progress?: Progress;
  /** The newest tool call, as the log line says it, and when. */
  last?: string;
  lastAt?: string;
  /** The step has finished (a `step.finished` event was seen). */
  finished: boolean;
}

/** Progress report of a "model working" event, when it is one. */
export function progressOf(event: JobRunEvent): Progress | undefined {
  const { turn, thinkingChars, toolArgsChars, textChars } = event.data;
  if (typeof turn !== "number") return undefined;
  return {
    turn,
    thinkingChars: Number(thinkingChars ?? 0),
    toolArgsChars: Number(toolArgsChars ?? 0),
    textChars: Number(textChars ?? 0),
    at: event.at,
  };
}

const kb = (chars: number): string => (chars < 1000 ? String(chars) : `${(chars / 1000).toFixed(1)}k`);

/** "turn 15 · thinking 135.3k · writing 22.9k" — what a working model is doing. */
export const describeProgress = (progress: Progress): string =>
  `turn ${progress.turn} · thinking ${kb(progress.thinkingChars)}${progress.toolArgsChars > 0 ? ` · tool arguments ${kb(progress.toolArgsChars)}` : ""}${progress.textChars > 0 ? ` · text ${kb(progress.textChars)}` : ""}`;

/** What the events say about each step, keyed by the step's run id ("" for the run itself). */
export function statsByStep(events: readonly JobRunEvent[]): Map<string, StepStats> {
  const stats = new Map<string, StepStats>();
  for (const event of events) {
    const key = event.stepRunId ?? "";
    const entry = stats.get(key) ?? { tools: {}, total: 0, blocked: 0, finished: false };
    const category = categoryOf(event);
    if (category === "tool") {
      const tool = toolOf(event) ?? "tool";
      entry.tools[tool] = (entry.tools[tool] ?? 0) + 1;
      entry.total += 1;
      if (event.data["decision"] === "blocked") entry.blocked += 1;
      entry.last = event.message;
      entry.lastAt = event.at;
    } else if (category === "model") {
      const progress = progressOf(event);
      if (progress !== undefined) {
        entry.turn = progress.turn;
        entry.progress = progress;
      }
    }
    if (event.kind === "step.finished") entry.finished = true;
    stats.set(key, entry);
  }
  return stats;
}

/** The ids of a step and every step below it, from the children loaded so far. */
export function withDescendants(id: string, childrenOf: Readonly<Record<string, string[]>>): Set<string> {
  const ids = new Set<string>();
  const visit = (current: string): void => {
    if (ids.has(current)) return;
    ids.add(current);
    for (const child of childrenOf[current] ?? []) visit(child);
  };
  visit(id);
  return ids;
}

/** One line of the exported log. */
export const logLine = (event: JobRunEvent, label: string): string => `${event.at}  ${label.padEnd(24)}  ${event.message}`;

/** A burst of the same kind of tool call by one step, told in plain words (the overview's activity feed). */
export interface FeedGroup {
  key: string;
  stepRunId: string | undefined;
  tool: string;
  count: number;
  /** What the burst touched: a folder when they share one, a file name, a pattern. */
  target: string;
  /** The burst is the newest thing its step did. */
  at: string;
  /** The tool calls were blocked. */
  blocked: boolean;
}

export const tidyPath = (text: string): string => text.replaceAll("[redacted]/", "").replace(/^(as-is|to-be)\//, "");

/** Consecutive tool calls of one step with the same tool become one group; a step's other events end its burst. */
export function feedGroups(events: readonly JobRunEvent[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  const open = new Map<string, { group: FeedGroup; targets: string[] }>();
  for (const event of events) {
    if (categoryOf(event) !== "tool") continue;
    const tool = toolOf(event) ?? "tool";
    const blocked = event.data["decision"] === "blocked";
    const step = event.stepRunId ?? "";
    const body = event.message.startsWith("blocked: ") ? event.message.slice(9) : event.message;
    const rest = tidyPath(body.startsWith(tool) ? body.slice(tool.length).trimStart() : body);
    const current = open.get(step);
    if (current !== undefined && current.group.tool === tool && current.group.blocked === blocked) {
      current.group.count += 1;
      current.group.at = event.at;
      current.targets.push(rest);
    } else {
      const group: FeedGroup = { key: event.id, stepRunId: event.stepRunId, tool, count: 1, target: rest, at: event.at, blocked };
      groups.push(group);
      open.set(step, { group, targets: [rest] });
    }
    const entry = open.get(step)!;
    const first = entry.targets[0] ?? "";
    const folders = new Set(entry.targets.map((target) => (target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "")));
    entry.group.target =
      entry.targets.length === 1
        ? first
        : folders.size === 1 && [...folders][0] !== ""
          ? `${[...folders][0]}/`
          : `${first.split(" ")[0] ?? first} and others`;
  }
  return groups;
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** "Read 12 files in app/cbl", "Wrote result.json", "Searched app for “CCDA-MSG”": what a burst of tool calls did. */
export function describeGroup(group: FeedGroup): string {
  const { tool, count, target, blocked } = group;
  const where = target === "" ? "" : ` ${count === 1 ? "" : "in "}${target}`.replace("  ", " ");
  if (blocked) return `Blocked ${plural(count, "call")} (${tool})${target === "" ? "" : ` ${target}`}`;
  switch (tool) {
    case "read":
      return count === 1 ? `Read ${target}` : `Read ${plural(count, "file")}${where}`;
    case "write":
      return count === 1 ? `Wrote ${target}` : `Wrote ${plural(count, "file")}${where}`;
    case "edit":
      return count === 1 ? `Edited ${target}` : `Edited ${plural(count, "file")}${where}`;
    case "grep":
      return count === 1 ? `Searched ${target}` : `Ran ${plural(count, "search", "searches")}${where}`;
    case "find":
      return count === 1 ? `Looked for files ${target}` : `Looked for files ${count} times`;
    case "ls":
      return count === 1 ? `Listed ${target || "a folder"}` : `Listed ${plural(count, "folder")}`;
    case "shell":
    case "git":
      return count === 1 ? `Ran a command: ${target}` : `Ran ${plural(count, "command")}`;
    case "codemode":
      return count === 1 ? "Ran an analysis script" : `Ran ${plural(count, "analysis script")}`;
    default:
      return `${tool}${count > 1 ? ` ×${count}` : ""} ${target}`.trim();
  }
}

/** Names like `business-rules-extractor` as people say them. */
export const humanize = (name: string): string => {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words === "" ? name : words[0]!.toUpperCase() + words.slice(1);
};

/** One step on the run's timeline: where its bar starts and how long it is, as shares of the whole run. */
export interface TimelineRow {
  id: string;
  name: string;
  status: JobRunView["status"];
  /** Undefined for a step that has not started. */
  offsetPct?: number;
  widthPct?: number;
  durationMs?: number;
}

/**
 * The steps of a run laid on one time axis, from the first start to the last finish (or `now` while a step runs), so
 * parallel steps overlap and the slow one shows. A step that has not started has a row but no bar.
 */
export function timelineOf(steps: readonly JobRunView[], now: number): { rows: TimelineRow[]; totalMs: number; started: number } {
  const started = steps.filter((step) => step.startedAt !== undefined);
  if (started.length === 0)
    return { rows: steps.map((step) => ({ id: step.id, name: step.name, status: step.status })), totalMs: 0, started: 0 };
  const begin = Math.min(...started.map((step) => Date.parse(step.startedAt!)));
  const endOf = (step: JobRunView): number => (step.finishedAt === undefined ? now : Date.parse(step.finishedAt));
  const totalMs = Math.max(1, Math.max(...started.map(endOf)) - begin);
  const rows = steps.map((step): TimelineRow => {
    if (step.startedAt === undefined) return { id: step.id, name: step.name, status: step.status };
    const from = Date.parse(step.startedAt) - begin;
    const durationMs = Math.max(0, endOf(step) - Date.parse(step.startedAt));
    return {
      id: step.id,
      name: step.name,
      status: step.status,
      offsetPct: (from / totalMs) * 100,
      widthPct: Math.max((durationMs / totalMs) * 100, 0.8),
      durationMs,
    };
  });
  return { rows, totalMs, started: started.length };
}
