// The live record of one run as data: the events followed over Server-Sent Events, what kind of
// line each is, and what the events say about each step (tools used, the model's turn, the last
// thing it did). Shared by the steps panel and the log console of a run.

import { useEffect, useRef, useState } from "react";
import { type JobRunEvent, jobRunsApi } from "@/lib/api/job-runs";

/** Lines kept in memory; the log keeps the newest. */
const MAX_EVENTS = 3000;

/** The events of a run, replayed from the start and then as the worker records them. */
export function useRunEvents(projectId: string, runId: string, handlers: { onStatus: () => void; onStep?: (() => void) | undefined }): { events: JobRunEvent[]; live: boolean } {
  const [events, setEvents] = useState<JobRunEvent[]>([]);
  const [live, setLive] = useState(true);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    let first = true;
    const close = jobRunsApi.follow(projectId, runId, {
      onEvent: (event) => {
        setEvents((current) => [...current, event].slice(-MAX_EVENTS));
        if (event.kind === "step.started" || event.kind === "step.finished") latest.current.onStep?.();
      },
      onStatus: () => {
        // The first status is the current one; later ones are changes.
        if (!first) latest.current.onStatus();
        first = false;
      },
      onEnd: () => {
        setLive(false);
        if (!first) latest.current.onStatus();
      },
    });
    return close;
  }, [projectId, runId]);

  return { events, live };
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

export type LogCategory ="tool" | "model" | "status" | "log";

export const categoryOf = (event: JobRunEvent): LogCategory =>
  event.kind === "tool" ? "tool" : event.kind === "status" || event.kind === "step.started" || event.kind === "step.finished" ? "status" : typeof event.data["turn"] === "number" ? "model" : "log";

/** The kernel tool a tool event is about (`read`, `grep`, …). */
export const toolOf = (event: JobRunEvent): string | undefined => (typeof event.data["tool"] === "string" ? event.data["tool"] : undefined);

/** A blocked tool call, a failed or cancelled run or step, a stalled agent. */
export const isProblem = (event: JobRunEvent): boolean =>
  (event.kind === "tool" && event.data["decision"] === "blocked") ||
  ((event.kind === "status" || event.kind === "step.finished") && (event.data["status"] === "failed" || event.data["status"] === "cancelled")) ||
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
  return { turn, thinkingChars: Number(thinkingChars ?? 0), toolArgsChars: Number(toolArgsChars ?? 0), textChars: Number(textChars ?? 0), at: event.at };
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
