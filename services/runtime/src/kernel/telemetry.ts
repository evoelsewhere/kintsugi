// Telemetry of a job (ADR-0048), on the vendor-neutral contract of `@earendil-works/pi-telemetry`.
//
// pi 1.3.0 ships that contract but emits no spans itself, so the kernel builds them from the session
// events it already reads (turns, tool calls, compactions, retries). `JobTelemetry` is the adapter: it
// implements `TelemetryContext`, stamps each span with its start time and duration, and hands every
// settled span to a sink, which the kernel turns into a `span` JobEvent. Nothing leaves the job process
// but those events; an OpenTelemetry exporter would be a second adapter behind the same contract.

import type { AttributeValue, RecordedTelemetrySpan, SpanAttributes, SpanOptions, SpanStatus, TelemetryContext, TelemetrySpan } from "@earendil-works/pi-telemetry";
import { NOOP_TELEMETRY_CONTEXT } from "@earendil-works/pi-telemetry";
import type { JobSpan } from "@kintsugi/runtime-sdk";

type Scalar = string | number | boolean;

interface Node {
  sequence: number;
  /** Order of settlement, set when the span settles. */
  endSequence?: number;
  id: string;
  parent?: Node;
  name: string;
  startedAt: string;
  startedMs: number;
  attributes: Record<string, Scalar>;
  events: Array<{ name: string; attributes: Record<string, Scalar> }>;
  status: SpanStatus;
  explicitStatus: boolean;
  settled: boolean;
}

/** Arrays become one comma-separated string: a span attribute is a scalar in the job event. */
function scalar(value: AttributeValue): Scalar {
  return Array.isArray(value) ? value.join(",") : (value as Scalar);
}

function copyAttributes(attributes: SpanAttributes | undefined): Record<string, Scalar> {
  const copy: Record<string, Scalar> = {};
  if (attributes === undefined) return copy;
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) copy[name] = scalar(value);
  return copy;
}

function failure(error: unknown): SpanStatus {
  try {
    if (error instanceof Error) return { status: "error", error: { name: error.name, message: error.message } };
  } catch {
    // inspecting an error is passive: fall through to a status without details
  }
  return { status: "error" };
}

export class JobTelemetry implements TelemetryContext {
  #sequence = 0;
  #ended = 0;
  readonly #sink: (span: JobSpan) => void;
  /** Every span, in start order; kept only when asked to (tests), never in a running job. */
  readonly #retained: Node[] | undefined;
  readonly #pending = new Set<Promise<unknown>>();

  constructor(sink: (span: JobSpan) => void, options: { retain?: boolean } = {}) {
    this.#sink = sink;
    this.#retained = options.retain === true ? [] : undefined;
  }

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    return this.#start(undefined, options, callback);
  }

  /** Resolves once every span started so far has settled and been handed to the sink. */
  async whenIdle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  /** The retained spans as the contract's reference snapshot (conformance tests). */
  snapshot(): readonly RecordedTelemetrySpan[] {
    return (this.#retained ?? []).map((node) => ({
      id: node.sequence,
      parentId: node.parent?.sequence ?? null,
      name: node.name,
      attributes: { ...node.attributes },
      events: node.events.map((event) => ({ name: event.name, attributes: { ...event.attributes } })),
      status: node.status,
      settled: node.settled,
      ...(node.endSequence === undefined ? {} : { endSequence: node.endSequence }),
    }));
  }

  #start<T>(parent: Node | undefined, options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    if (parent?.settled) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    let node: Node;
    try {
      const sequence = ++this.#sequence;
      node = {
        sequence,
        id: `s${sequence}`,
        ...(parent === undefined ? {} : { parent }),
        name: options.name,
        startedAt: new Date().toISOString(),
        startedMs: performance.now(),
        attributes: copyAttributes(options.attributes),
        events: [],
        status: { status: "ok" },
        explicitStatus: false,
        settled: false,
      };
      this.#retained?.push(node);
    } catch {
      return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    }
    const span: TelemetrySpan = {
      startSpan: (childOptions, childCallback) => this.#start(node, childOptions, childCallback),
      addEvent: (name, attributes) => {
        if (node.settled) return;
        try {
          node.events.push({ name, attributes: copyAttributes(attributes) });
        } catch {
          // recording is passive
        }
      },
      setAttributes: (attributes) => {
        if (node.settled) return;
        try {
          Object.assign(node.attributes, copyAttributes(attributes));
        } catch {
          // recording is passive
        }
      },
      setStatus: (status) => {
        if (node.settled) return;
        try {
          node.status = status.status === "ok" ? { status: "ok" } : status.error === undefined ? { status: "error" } : { status: "error", error: { name: status.error.name, message: status.error.message } };
          node.explicitStatus = true;
        } catch {
          // recording is passive
        }
      },
    };
    let result: T | Promise<T>;
    try {
      result = callback(span);
    } catch (error) {
      this.#settle(node, true, error);
      return Promise.reject(error);
    }
    const settled = Promise.resolve(result).then(
      (value) => {
        this.#settle(node, false);
        return value;
      },
      (error: unknown) => {
        this.#settle(node, true, error);
        throw error;
      },
    );
    const tracked = settled.then(undefined, () => undefined);
    this.#pending.add(tracked);
    void tracked.then(() => this.#pending.delete(tracked));
    return settled;
  }

  #settle(node: Node, failed: boolean, error?: unknown): void {
    if (node.settled) return;
    if (failed && !node.explicitStatus) node.status = failure(error);
    node.settled = true;
    node.endSequence = this.#ended++;
    try {
      const span: JobSpan = {
        id: node.id,
        ...(node.parent === undefined ? {} : { parentId: node.parent.id }),
        name: node.name,
        startedAt: node.startedAt,
        durationMs: Math.max(0, Math.round(performance.now() - node.startedMs)),
        status: node.status.status,
        ...(node.status.status === "error" && node.status.error !== undefined ? { error: node.status.error.message.slice(0, 300) } : {}),
        attributes: { ...node.attributes },
      };
      this.#sink(span);
    } catch {
      // a failing sink never fails the job
    }
  }
}

/** A span the kernel opens when something starts and closes when it ends: the session reports both as separate events. */
export interface LiveSpan {
  readonly span: TelemetrySpan;
  /** Adds attributes and a status, then lets the span settle. Calling it again does nothing. */
  end(attributes?: SpanAttributes, status?: SpanStatus): void;
}

/** Opens a span under `parent` that stays open until `end()`. The contract runs the callback synchronously, so the span is ready on return. */
export function beginSpan(parent: TelemetryContext, name: string, attributes?: SpanAttributes): LiveSpan {
  let captured: TelemetrySpan | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  parent
    .startSpan({ name, ...(attributes === undefined ? {} : { attributes }) }, (span) => {
      captured = span;
      return finished;
    })
    .catch(() => undefined);
  const span = captured ?? (NOOP_SPAN as TelemetrySpan);
  let ended = false;
  return {
    span,
    end(more, status) {
      if (ended) return;
      ended = true;
      if (more !== undefined) span.setAttributes(more);
      if (status !== undefined) span.setStatus(status);
      finish();
    },
  };
}

const NOOP_SPAN: TelemetrySpan = {
  startSpan: (options, callback) => NOOP_TELEMETRY_CONTEXT.startSpan(options, callback),
  addEvent: () => undefined,
  setAttributes: () => undefined,
  setStatus: () => undefined,
};
