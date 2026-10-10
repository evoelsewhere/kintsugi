// Deterministic stand-in for the pi backend: runs the shared job loop
// (JobSpec → JobHandle → JobEvent) with simulated turns and no LLM calls, so the
// orchestrator, job gateway and telemetry can be built and tested against the contract.
// Each simulated turn calls one tool, cycling through "read" and the agent's own tools;
// tools outside the allowlist show up as blocked calls.

import { randomUUID } from "node:crypto";
import type { JobEvent, JobFailureReason, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { EventStream } from "./event-stream.js";

type JobEnd = Extract<JobEvent, { type: "job.completed" | "job.failed" }>;

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const now = (): string => new Date().toISOString();

class MockJob implements JobHandle {
  readonly jobId = randomUUID();
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<JobEnd>;

  #ended = false;
  #resolveDone!: (event: JobEnd) => void;

  constructor(
    private readonly spec: JobSpec,
    private readonly runtimeVersion: string,
  ) {
    this.done = new Promise<JobEnd>((resolve) => {
      this.#resolveDone = resolve;
    });
    void this.#run();
  }

  async abort(reason: string): Promise<void> {
    this.#end({ type: "job.failed", jobId: this.jobId, at: now(), reason: "aborted", error: reason });
  }

  #emit(event: JobEvent): void {
    if (!this.#ended) this.events.push(event);
  }

  #end(event: JobEnd): void {
    if (this.#ended) return;
    this.events.push(event);
    this.#ended = true;
    this.events.close();
    this.#resolveDone(event);
  }

  #fail(reason: JobFailureReason, error: string): void {
    this.#end({ type: "job.failed", jobId: this.jobId, at: now(), reason, error });
  }

  async #run(): Promise<void> {
    const { spec } = this;
    this.#emit({
      type: "job.started",
      jobId: this.jobId,
      at: now(),
      runtimeVersion: this.runtimeVersion,
      agent: `${spec.agent.id}@${spec.agent.version}`,
      ...(spec.metadata === undefined ? {} : { metadata: spec.metadata }),
    });
    await tick();

    this.#emit({ type: "message.delta", jobId: this.jobId, text: `[mock ${spec.agent.id}] ${spec.task}\n` });
    await tick();

    const turns = Math.min(spec.limits.maxTurns ?? 3, 8);
    const candidates = ["read", ...spec.agent.tools.filter((tool) => tool !== "read")];
    let blocked = 0;

    for (let turn = 0; turn < turns; turn++) {
      if (this.#ended) return;
      const tool = candidates[turn % candidates.length] ?? "read";
      const allowed = spec.agent.tools.includes(tool);
      const callId = `${this.jobId}-${turn}`;
      this.#emit({
        type: "tool.call",
        jobId: this.jobId,
        callId,
        tool,
        input: { turn, purpose: "simulated" },
        decision: allowed ? "allowed" : "blocked",
        ...(allowed ? {} : { reason: `"${tool}" is not in the agent's tool allowlist` }),
      });
      await tick();
      if (allowed) {
        this.#emit({ type: "tool.result", jobId: this.jobId, callId, ok: true, summary: `${tool} completed (simulated)` });
        if (tool === "outputs_write") this.#emit({ type: "output", jobId: this.jobId, path: `mock/turn-${turn}.md` });
      } else {
        blocked++;
      }
      await tick();
    }

    const inputTokens = 128 * turns;
    const outputTokens = 64 * turns;
    const costUsd = Number((inputTokens * 0.000001 + outputTokens * 0.000005).toFixed(6));
    this.#emit({ type: "usage", jobId: this.jobId, model: `${spec.model.provider}/${spec.model.id}`, inputTokens, outputTokens, costUsd });

    if (spec.limits.maxCostUsd !== undefined && costUsd > spec.limits.maxCostUsd) {
      this.#fail("budget", `cost ${costUsd} USD exceeded ${spec.limits.maxCostUsd} USD`);
      return;
    }
    this.#end({
      type: "job.completed",
      jobId: this.jobId,
      at: now(),
      summary: `simulated run: ${turns} turn(s), ${blocked} blocked call(s)`,
    });
  }
}

/** Starts a simulated job. The returned handle behaves like a real one, minus the LLM. */
export function startMockJob(spec: JobSpec, runtimeVersion: string): JobHandle {
  return new MockJob(spec, runtimeVersion);
}
