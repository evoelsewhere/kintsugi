// Deterministic stand-in for the pi backend: runs the shared job loop
// (JobSpec → JobHandle → JobEvent) with simulated agent steps and no LLM calls.
// It exists so the orchestrator, job gateway and telemetry pipeline can be built
// and tested against the contract before real pi jobs run (ADR-0001, ADR-0004).

import { randomUUID } from "node:crypto";
import type { JobEvent, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { EventStream } from "./event-stream.js";
import { describeInputs } from "./job-inputs.js";

type JobCompleted = Extract<JobEvent, { type: "job.completed" }>;

/** Tools the mock cycles through; the first two exercise the ToolPolicy path. */
const SIMULATED_TOOLS = ["read", "bash", "write"] as const;

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const now = (): string => new Date().toISOString();

class MockJob implements JobHandle {
  readonly jobId = randomUUID();
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<JobCompleted>;

  #settled = false;
  #resolveDone!: (event: JobCompleted) => void;
  #rejectDone!: (error: unknown) => void;

  constructor(
    private readonly spec: JobSpec,
    private readonly runtimeVersion: string,
  ) {
    this.done = new Promise<JobCompleted>((resolve, reject) => {
      this.#resolveDone = resolve;
      this.#rejectDone = reject;
    });
    // Callers may rely on `events` alone; keep an unawaited rejection from surfacing.
    this.done.catch(() => undefined);
    void this.#run();
  }

  async followUp(message: string): Promise<void> {
    if (this.#settled) {
      throw new Error("mock job already finished; interactive follow-ups need the pi backend");
    }
    this.events.push({ type: "message.delta", jobId: this.jobId, text: `> ${message}\n` });
  }

  async abort(reason: string): Promise<void> {
    if (this.#settled) return;
    this.#settled = true;
    this.#rejectDone(new Error(reason));
    this.events.push({ type: "job.failed", jobId: this.jobId, at: now(), error: reason });
    this.events.close();
  }

  #emit(event: JobEvent): void {
    this.events.push(event);
  }

  #complete(summary: string): void {
    if (this.#settled) return;
    this.#settled = true;
    const event: JobCompleted = { type: "job.completed", jobId: this.jobId, at: now(), summary };
    this.#resolveDone(event);
    this.events.push(event);
    this.events.close();
  }

  #fail(error: string): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#rejectDone(new Error(error));
    this.events.push({ type: "job.failed", jobId: this.jobId, at: now(), error });
    this.events.close();
  }

  async #run(): Promise<void> {
    const spec = this.spec;
    this.#emit({ type: "job.started", jobId: this.jobId, at: now(), runtimeVersion: this.runtimeVersion });
    await tick();

    this.#emit({
      type: "message.delta",
      jobId: this.jobId,
      text: `[mock ${spec.agent.id}] rulebook ${spec.rulebook.version}${spec.rulebook.commit ? `@${spec.rulebook.commit}` : ""}, packs: ${spec.packs.join(", ") || "(none)"}\n`,
    });
    await tick();

    this.#emit({
      type: "message.delta",
      jobId: this.jobId,
      text: `Inputs: ${describeInputs(spec.inputs) || "(none)"}\n`,
    });
    await tick();

    const maxTurns = Math.min(Math.max(spec.budget.maxTurns ?? 3, 1), 8);
    let toolCalls = 0;
    let blockedCalls = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.#settled) return;
      const tool = SIMULATED_TOOLS[turn % SIMULATED_TOOLS.length] ?? "read";
      const allowed = spec.policy.allowTools.includes(tool);
      const callId = `${this.jobId}-${turn}`;
      toolCalls++;

      this.#emit({
        type: "tool.call",
        jobId: this.jobId,
        callId,
        tool,
        input: { turn, purpose: "simulated" },
        decision: allowed ? "allowed" : "blocked",
        ...(allowed ? {} : { reason: `"${tool}" is not in the agent's allowTools policy` }),
      });
      await tick();

      if (allowed) {
        this.#emit({ type: "tool.result", jobId: this.jobId, callId, ok: true, summary: `${tool} completed (simulated)` });
      } else {
        blockedCalls++;
        this.#emit({ type: "tool.result", jobId: this.jobId, callId, ok: false, summary: `${tool} blocked by policy` });
      }
      await tick();
    }

    for (const rule of spec.outputs) {
      if (this.#settled) return;
      this.#emit({ type: "output", jobId: this.jobId, target: "file", ref: rule.path });
      await tick();
    }

    const inputTokens = 128 * maxTurns;
    const outputTokens = 64 * maxTurns;
    const costUsd = Number(((inputTokens * 0.000001 + outputTokens * 0.000005)).toFixed(6));
    this.#emit({
      type: "usage",
      jobId: this.jobId,
      model: `${spec.model.provider}/${spec.model.id}`,
      inputTokens,
      outputTokens,
      costUsd,
    });

    if (spec.budget.maxCostUsd !== undefined && costUsd > spec.budget.maxCostUsd) {
      this.#fail(`budget exceeded: ${costUsd} USD > ${spec.budget.maxCostUsd} USD`);
      return;
    }

    this.#complete(
      `${spec.agent.id} simulated run: ${maxTurns} turn(s), ${toolCalls} tool call(s) (${blockedCalls} blocked), ${spec.outputs.length} output(s)`,
    );
  }
}

/** Starts a simulated job. The returned handle behaves like a real one, minus the LLM. */
export function startMockJob(spec: JobSpec, runtimeVersion: string): JobHandle {
  return new MockJob(spec, runtimeVersion);
}
