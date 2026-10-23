// Live updates: one Server-Sent Events stream per tab (GET /api/events) says which topic changed and, where it has
// one, whose (a project id); a view that subscribes to the topics it shows reads its data again then, instead of
// asking on a timer. Changes that come in a burst are delivered once, and a view reads again at most every
// `MIN_GAP_MS`. While the tab is hidden nothing is read: a view that changed is read when the tab shows again, and
// so is every view after the stream reconnected (changes may have been missed meanwhile).

export type LiveTopic = "job-runs" | "document-writes" | "repositories" | "workers" | "gates" | "audit" | "telemetry";

/** A topic, or `topic:scope` for the changes of one scope only (a project id). */
export type LiveSpec = LiveTopic | `${LiveTopic}:${string}`;

/** What the overview counts and the worker status are made of. */
export const OVERVIEW_TOPICS: readonly LiveSpec[] = ["job-runs", "document-writes", "repositories", "workers", "gates"];

/**
 * A worker that stops (a crash, a lost network) changes nothing in the database: it only stops being seen, so the
 * views that say whether workers are up also read again on this timer. The one place a timer is left besides the
 * sandbox folders, which are on disk.
 */
export const WORKER_AGES = (): number => 30_000;

const MIN_GAP_MS = 1500;
/** The stream closes this long after its last subscriber left, so a view that remounts does not reopen it. */
const IDLE_CLOSE_MS = 5000;

interface Subscriber {
  specs: readonly LiveSpec[];
  onChange: () => void;
  dirty: boolean;
  last: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Change {
  topic: string;
  scope: string;
}

const subscribers = new Set<Subscriber>();
let source: EventSource | undefined;
let opened = false;
let idle: ReturnType<typeof setTimeout> | undefined;

const matches = (specs: readonly LiveSpec[], change: Change): boolean =>
  specs.some((spec) => {
    const at = spec.indexOf(":");
    return at < 0 ? spec === change.topic : spec.slice(0, at) === change.topic && spec.slice(at + 1) === change.scope;
  });

/** Calls `onChange` for every subscriber that is dirty, now or when the minimum gap since its last call is over. */
function deliver(): void {
  if (document.hidden) return;
  for (const subscriber of subscribers) {
    if (!subscriber.dirty || subscriber.timer !== undefined) continue;
    const wait = subscriber.last + MIN_GAP_MS - Date.now();
    const run = (): void => {
      subscriber.timer = undefined;
      if (!subscriber.dirty || document.hidden || !subscribers.has(subscriber)) return;
      subscriber.dirty = false;
      subscriber.last = Date.now();
      subscriber.onChange();
    };
    if (wait > 0) subscriber.timer = setTimeout(run, wait);
    else run();
  }
}

function markAll(): void {
  for (const subscriber of subscribers) subscriber.dirty = true;
  deliver();
}

function parse(message: Event): unknown {
  try {
    return JSON.parse((message as MessageEvent<string>).data);
  } catch {
    return undefined;
  }
}

function open(): void {
  if (source !== undefined || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("open", () => {
    // The first open has nothing to catch up on; a reconnect may have missed changes.
    if (opened) markAll();
    opened = true;
  });
  source.addEventListener("change", (message) => {
    const body = parse(message) as { changes?: Change[] } | undefined;
    for (const change of body?.changes ?? []) {
      for (const subscriber of subscribers) if (matches(subscriber.specs, change)) subscriber.dirty = true;
    }
    deliver();
  });
  source.addEventListener("resync", markAll);
}

function closeWhenIdle(): void {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (subscribers.size > 0) return;
    source?.close();
    source = undefined;
    opened = false;
  }, IDLE_CLOSE_MS);
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", deliver);

/** Calls `onChange` when something of `specs` changes; returns the function that stops it. */
export function subscribeLive(specs: readonly LiveSpec[], onChange: () => void): () => void {
  const subscriber: Subscriber = { specs, onChange, dirty: false, last: 0, timer: undefined };
  subscribers.add(subscriber);
  clearTimeout(idle);
  open();
  return () => {
    clearTimeout(subscriber.timer);
    subscribers.delete(subscriber);
    if (subscribers.size === 0) closeWhenIdle();
  };
}
