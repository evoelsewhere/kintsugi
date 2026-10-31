// What an agent attempt spent, from the spans it settled (ADR-0048). The kernel sends the attempt's root span
// (`kintsugi.job`, with the totals Governance → Telemetry counts) only when it ends the job itself; an attempt whose
// process was killed (a cancel, the idle watchdog, the wall-clock limit, a crash) never sends it, and was missing from
// the telemetry with everything it had spent (T2-008). The worker then records the root span from the turns and
// compactions that did settle; the turn that was running when the process died is not in them.

import { randomUUID } from "node:crypto";
import type { JobEvent, JobSpan } from "@kintsugi/runtime-sdk";

type JobEnd = Extract<JobEvent, { type: "job.completed" | "job.failed" }>;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export class AttemptSpans {
  readonly #startedAt = new Date();
  #root = false;
  /** The root's id as the turns name it, so the recorded root keeps the attempt one tree. */
  #rootId: string | undefined;
  #turns = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #cacheReadTokens = 0;
  #cacheWriteTokens = 0;
  #costUsd = 0;
  #compactions = 0;
  #contextPeakPercent = 0;

  /** Takes one span the attempt reported. */
  add(span: JobSpan): void {
    if (span.name === "kintsugi.job" && span.parentId === undefined) {
      this.#root = true;
      return;
    }
    const a = span.attributes;
    if (span.name === "kintsugi.turn") {
      this.#rootId ??= span.parentId;
      this.#turns += 1;
      this.#inputTokens += num(a["inputTokens"]);
      this.#outputTokens += num(a["outputTokens"]);
      this.#cacheReadTokens += num(a["cacheReadTokens"]);
      this.#cacheWriteTokens += num(a["cacheWriteTokens"]);
      this.#costUsd += num(a["costUsd"]);
      this.#contextPeakPercent = Math.max(this.#contextPeakPercent, num(a["contextPercent"]));
    } else if (span.name === "kintsugi.compaction") {
      // A summary is a model call of its own; the kernel counts it in the job's totals too.
      this.#inputTokens += num(a["summaryInputTokens"]);
      this.#outputTokens += num(a["summaryOutputTokens"]);
      this.#costUsd += num(a["summaryCostUsd"]);
      if (span.status === "ok" && a["aborted"] !== true) this.#compactions += 1;
    }
  }

  /**
   * The root span the kernel did not send, or undefined when it did. `outcome` names how the attempt ended
   * (`cancelled`, `stopped`, or the kernel's failure reason); only a completed attempt counts as ok.
   */
  missingRoot(end: JobEnd, outcome: string, labels: { agent: string; agentVersion: string; provider: string; model: string }, error?: string): JobSpan | undefined {
    if (this.#root) return undefined;
    const ok = end.type === "job.completed";
    return {
      id: this.#rootId ?? randomUUID(),
      name: "kintsugi.job",
      startedAt: this.#startedAt.toISOString(),
      durationMs: Math.max(0, Date.now() - this.#startedAt.getTime()),
      status: ok ? "ok" : "error",
      ...(ok || error === undefined ? {} : { error }),
      attributes: {
        ...labels,
        turns: this.#turns,
        inputTokens: this.#inputTokens,
        outputTokens: this.#outputTokens,
        cacheReadTokens: this.#cacheReadTokens,
        cacheWriteTokens: this.#cacheWriteTokens,
        costUsd: this.#costUsd,
        compactions: this.#compactions,
        contextPeakPercent: Math.round(this.#contextPeakPercent * 10) / 10,
        outcome,
        // The worker recorded it from the settled spans: the turn that was running when the attempt stopped is missing.
        recordedBy: "worker",
      },
    };
  }
}
