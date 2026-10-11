// One running job: maps pi session events onto JobEvents, enforces the job limits and
// decides the outcome. pi does not reject `prompt()` when the LLM call fails — it records
// an assistant message with stopReason "error" / "aborted" — so the outcome is read from
// the last assistant message, never assumed from the promise.

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { JobEvent, JobFailureReason, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { EventStream } from "../event-stream.js";

type JobEnd = Extract<JobEvent, { type: "job.completed" | "job.failed" }>;

const now = (): string => new Date().toISOString();

/** Structural view of pi's AssistantMessage: only what outcome and usage need. */
interface AssistantLike {
  role: "assistant";
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
}

const isAssistant = (message: unknown): message is AssistantLike =>
  typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";

export class KernelJob implements JobHandle {
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<JobEnd>;

  #resolveDone!: (event: JobEnd) => void;
  #session: AgentSession | undefined;
  #dispose: (() => void) | undefined;
  #unsubscribe: (() => void) | undefined;
  #timer: NodeJS.Timeout | undefined;
  #aborting: Promise<unknown> = Promise.resolve();
  #ended = false;
  /** Set when the kernel (or the caller) stops the run; wins over the message outcome. */
  #stop: { reason: JobFailureReason; error: string } | undefined;
  #turns = 0;
  #blocked = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #costUsd = 0;
  #last: AssistantLike | undefined;
  /**
   * When the session last showed any sign of work: every session event, including thinking and
   * tool-call argument deltas that produce no JobEvent. The agent child turns it into liveness
   * lines for the launcher's idle watchdog.
   */
  lastActivityAt = Date.now();

  constructor(
    readonly jobId: string,
    private readonly spec: JobSpec,
    runtimeVersion: string,
  ) {
    this.done = new Promise<JobEnd>((resolve) => {
      this.#resolveDone = resolve;
    });
    this.events.push({
      type: "job.started",
      jobId,
      at: now(),
      runtimeVersion,
      agent: `${spec.agent.id}@${spec.agent.version}`,
      ...(spec.metadata === undefined ? {} : { metadata: spec.metadata }),
    });
  }

  /** Runs the task on the session; resolves when the job has ended. */
  async run(session: AgentSession, dispose: () => void): Promise<void> {
    this.#session = session;
    this.#dispose = dispose;
    if (this.#ended) return this.#teardown();
    this.#unsubscribe = session.subscribe((event) => this.#onEvent(event));
    this.#timer = setTimeout(() => void this.#halt("timeout", `timed out after ${this.spec.limits.timeoutSec}s`), this.spec.limits.timeoutSec * 1000);
    try {
      await session.prompt(this.spec.task);
      this.#finish();
    } catch (error) {
      this.#end({ reason: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Fails the job before a session exists (model or tool setup errors). */
  failToStart(error: unknown): void {
    this.#end({ reason: "error", error: error instanceof Error ? error.message : String(error) });
  }

  async abort(reason: string): Promise<void> {
    await this.#halt("aborted", reason);
  }

  /** Called by the command policy when it blocks a tool call. */
  blocked(tool: string, reason: string, input: unknown): void {
    if (this.#ended) return;
    this.#blocked += 1;
    this.events.push({ type: "tool.call", jobId: this.jobId, callId: `blocked-${this.#blocked}`, tool, input, decision: "blocked", reason });
  }

  /** Called by outputs_write after a file landed in the output directory. */
  output(path: string): void {
    if (!this.#ended) this.events.push({ type: "output", jobId: this.jobId, path });
  }

  async #halt(reason: JobFailureReason, error: string): Promise<void> {
    if (this.#ended || this.#stop !== undefined) return;
    this.#stop = { reason, error };
    if (this.#session === undefined) {
      this.#end(this.#stop);
      return;
    }
    // The job ends now; pi's abort can wait on an in-flight request, so the session is
    // disposed only once the abort has settled.
    this.#aborting = this.#session.abort().catch(() => undefined);
    this.#end(this.#stop);
    await this.#aborting;
  }

  #onEvent(event: AgentSessionEvent): void {
    if (this.#ended) return;
    this.lastActivityAt = Date.now();
    switch (event.type) {
      case "turn_start": {
        this.#turns += 1;
        const max = this.spec.limits.maxTurns;
        if (max !== undefined && this.#turns > max) void this.#halt("max-turns", `stopped after ${max} turn(s)`);
        return;
      }
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.events.push({ type: "message.delta", jobId: this.jobId, text: event.assistantMessageEvent.delta });
        }
        return;
      case "tool_execution_start":
        this.events.push({ type: "tool.call", jobId: this.jobId, callId: event.toolCallId, tool: event.toolName, input: event.args, decision: "allowed" });
        return;
      case "tool_execution_end":
        this.events.push({
          type: "tool.result",
          jobId: this.jobId,
          callId: event.toolCallId,
          ok: !event.isError,
          ...(event.durationMs === undefined ? {} : { summary: `took ${event.durationMs} ms` }),
        });
        return;
      case "message_end": {
        if (!isAssistant(event.message)) return;
        this.#last = event.message;
        this.#inputTokens += event.message.usage?.input ?? 0;
        this.#outputTokens += event.message.usage?.output ?? 0;
        this.#costUsd += event.message.usage?.cost?.total ?? 0;
        const max = this.spec.limits.maxCostUsd;
        if (max !== undefined && this.#costUsd > max) void this.#halt("budget", `cost ${this.#costUsd.toFixed(4)} USD exceeded ${max} USD`);
        return;
      }
      default:
        return;
    }
  }

  #finish(): void {
    if (this.#stop !== undefined) return this.#end(this.#stop);
    const stopReason = this.#last?.stopReason;
    if (this.#last === undefined) return this.#end({ reason: "error", error: "the model returned no response" });
    if (stopReason === "error") return this.#end({ reason: "error", error: this.#last.errorMessage ?? "model error" });
    if (stopReason === "aborted") return this.#end({ reason: "aborted", error: this.#last.errorMessage ?? "aborted" });
    if (stopReason === "length") return this.#end({ reason: "error", error: "the response hit the model's output token limit" });
    this.#end(undefined);
  }

  #end(failure: { reason: JobFailureReason; error: string } | undefined): void {
    if (this.#ended) return;
    this.#ended = true;
    this.events.push({
      type: "usage",
      jobId: this.jobId,
      model: `${this.spec.model.provider}/${this.spec.model.id}`,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      costUsd: this.#costUsd,
    });
    const event: JobEnd =
      failure === undefined
        ? {
            type: "job.completed",
            jobId: this.jobId,
            at: now(),
            summary: `${this.#turns} turn(s), ${this.#inputTokens} input / ${this.#outputTokens} output tokens${
              this.#blocked === 0 ? "" : `, ${this.#blocked} blocked call(s)`
            }`,
          }
        : { type: "job.failed", jobId: this.jobId, at: now(), reason: failure.reason, error: failure.error };
    this.events.push(event);
    this.events.close();
    this.#teardown();
    this.#resolveDone(event);
  }

  #teardown(): void {
    clearTimeout(this.#timer);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    const dispose = this.#dispose;
    this.#dispose = undefined;
    if (dispose !== undefined) void this.#aborting.then(dispose);
  }
}
