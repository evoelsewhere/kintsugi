// One running job: maps pi session events onto JobEvents, enforces the job limits and
// decides the outcome. pi does not reject `prompt()` when the LLM call fails — it records
// an assistant message with stopReason "error" / "aborted" — so the outcome is read from
// the last assistant message, never assumed from the promise.

import { isContextOverflow, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { JobEvent, JobFailureReason, JobHandle, JobSpan, JobSpec } from "@kintsugi/runtime-sdk";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { EventStream } from "../event-stream.js";
import type { SourceRead } from "./tools.js";
import { beginSpan, JobTelemetry, type LiveSpan } from "./telemetry.js";

type JobEnd = Extract<JobEvent, { type: "job.completed" | "job.failed" }>;

function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

const now = (): string => new Date().toISOString();

/** Structural view of pi's AssistantMessage: only what outcome and usage need. */
interface AssistantLike {
  role: "assistant";
  stopReason?: string;
  errorMessage?: string;
  usage?: Usage;
}

/** Token counts of one model call (or of one compaction summary), as pi reports them. */
interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
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
  /** The workspace root as given and as its real path, for the paths of source.read. */
  #roots: string[] | undefined;
  #inputTokens = 0;
  #outputTokens = 0;
  #cacheReadTokens = 0;
  #cacheWriteTokens = 0;
  #costUsd = 0;
  #compactions = 0;
  #compacting = false;
  /** Set when pi gave up recovering from a context overflow (`compaction_end` with an error). */
  #overflowFailed = false;
  #contextPeakPercent = 0;
  #last: AssistantLike | undefined;
  #lastEventAt = Date.now();
  /** The job's spans (ADR-0048): one root, a span per turn, tool call, compaction and retry. */
  readonly #telemetry = new JobTelemetry((span) => this.#emitSpan(span));
  readonly #root: LiveSpan;
  #turnSpan: LiveSpan | undefined;
  #turnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, stopReason: "" };
  readonly #toolSpans = new Map<string, LiveSpan>();
  /** Calls a tool made through another one (codemode's nested calls), by the outer call's id. */
  readonly #nestedCalls = new Map<string, number>();
  #compactionSpan: LiveSpan | undefined;
  #retrySpan: LiveSpan | undefined;
  #streamed = { thinking: 0, toolArgs: 0, text: 0 };
  #progressAt = 0;

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
    this.#root = beginSpan(this.#telemetry, "kintsugi.job", {
      agent: spec.agent.id,
      agentVersion: spec.agent.version,
      provider: spec.model.provider,
      model: spec.model.id,
    });
  }

  /**
   * When the session last showed any sign of work: every session event, including thinking and
   * tool-call argument deltas that produce no JobEvent. The agent child turns it into liveness
   * lines for the launcher's idle watchdog. A compaction is one long model call with no events
   * while it runs, so the job counts as working for as long as it lasts.
   */
  get lastActivityAt(): number {
    return this.#compacting ? Date.now() : this.#lastEventAt;
  }

  /** Runs the task on the session; resolves when the job has ended. */
  async run(session: AgentSession, dispose: () => void): Promise<void> {
    this.#session = session;
    this.#dispose = dispose;
    if (this.#ended) return this.#teardown();
    this.#unsubscribe = session.subscribe((event) => this.#onEvent(event));
    if (this.spec.limits.timeoutSec > 0) {
      this.#timer = setTimeout(() => void this.#halt("timeout", `timed out after ${this.spec.limits.timeoutSec}s`), this.spec.limits.timeoutSec * 1000);
    }
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

  /** Called by write and edit after a file landed in the output directory. */
  output(path: string): void {
    if (!this.#ended) this.events.push({ type: "output", jobId: this.jobId, path });
  }

  /**
   * Called by read and grep with the lines they showed; the path becomes relative to the workspace (ADR-0086). grep
   * reports real paths (symbolic links resolved), so the root is tried as given and as its real path.
   */
  read(read: SourceRead): void {
    if (this.#ended) return;
    this.#roots ??= [...new Set([this.spec.workspace.root, realRoot(this.spec.workspace.root)])];
    for (const root of this.#roots) {
      const path = relative(root, read.path);
      if (path === "" || path.startsWith("..") || isAbsolute(path)) continue;
      this.events.push({ type: "source.read", jobId: this.jobId, tool: read.tool, path: path.split(sep).join("/"), from: read.from, to: read.to });
      return;
    }
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

  /** Counts streamed characters and reports them at most every 15 s as a progress event. */
  #track(update: { type: string; delta?: unknown }): void {
    const size = typeof update.delta === "string" ? update.delta.length : 0;
    if (update.type === "thinking_delta") this.#streamed.thinking += size;
    else if (update.type === "toolcall_delta") this.#streamed.toolArgs += size;
    else if (update.type === "text_delta") this.#streamed.text += size;
    const at = Date.now();
    if (at - this.#progressAt < 15_000) return;
    this.#progressAt = at;
    this.events.push({
      type: "progress",
      jobId: this.jobId,
      turn: this.#turns,
      thinkingChars: this.#streamed.thinking,
      toolArgsChars: this.#streamed.toolArgs,
      textChars: this.#streamed.text,
    });
  }

  #onEvent(event: AgentSessionEvent): void {
    if (this.#ended) return;
    this.#lastEventAt = Date.now();
    if (event.type === "message_update") this.#track(event.assistantMessageEvent);
    switch (event.type) {
      case "turn_start": {
        this.#turns += 1;
        this.#endTurn();
        this.#turnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, stopReason: "" };
        this.#turnSpan = beginSpan(this.#root.span, "kintsugi.turn", { turn: this.#turns });
        const max = this.spec.limits.maxTurns;
        if (max !== undefined && this.#turns > max) void this.#halt("max-turns", `stopped after ${max} turn(s)`);
        return;
      }
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.events.push({ type: "message.delta", jobId: this.jobId, text: event.assistantMessageEvent.delta });
        }
        return;
      case "turn_end":
        this.#endTurn();
        return;
      case "tool_execution_start":
        this.#beginTool(event.toolCallId, event.toolName, (event as { parentToolCallId?: string }).parentToolCallId);
        this.events.push({ type: "tool.call", jobId: this.jobId, callId: event.toolCallId, tool: event.toolName, input: event.args, decision: "allowed" });
        return;
      case "tool_execution_end":
        this.#endTool(event.toolCallId, !event.isError, event.durationMs);
        this.events.push({
          type: "tool.result",
          jobId: this.jobId,
          callId: event.toolCallId,
          ok: !event.isError,
          ...(event.durationMs === undefined ? {} : { summary: `took ${event.durationMs} ms`, durationMs: event.durationMs }),
        });
        return;
      case "message_end": {
        if (!isAssistant(event.message)) return;
        this.#last = event.message;
        this.#count(event.message.usage);
        this.#turnUsage.input += event.message.usage?.input ?? 0;
        this.#turnUsage.output += event.message.usage?.output ?? 0;
        this.#turnUsage.cacheRead += event.message.usage?.cacheRead ?? 0;
        this.#turnUsage.cacheWrite += event.message.usage?.cacheWrite ?? 0;
        this.#turnUsage.cost += event.message.usage?.cost?.total ?? 0;
        this.#turnUsage.stopReason = event.message.stopReason ?? "";
        this.#watchContext();
        return;
      }
      case "compaction_start":
        this.#compacting = true;
        this.#compactionSpan?.end();
        this.#compactionSpan = beginSpan((this.#turnSpan ?? this.#root).span, "kintsugi.compaction", { reason: event.reason });
        return;
      case "auto_retry_start":
        this.#retrySpan?.end();
        this.#retrySpan = beginSpan(this.#root.span, "kintsugi.retry", {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage.slice(0, 200),
        });
        return;
      case "auto_retry_end":
        this.#retrySpan?.end({ success: event.success, attempt: event.attempt }, event.success ? undefined : { status: "error", error: { name: "RetryFailed", message: (event.finalError ?? "the retry failed").slice(0, 300) } });
        this.#retrySpan = undefined;
        return;
      case "compaction_end":
        this.#compacting = false;
        this.#compactionSpan?.end(
          {
            aborted: event.aborted,
            willRetry: event.willRetry,
            ...(event.result === undefined ? {} : { tokensBefore: event.result.tokensBefore }),
            ...(event.result?.estimatedTokensAfter === undefined ? {} : { tokensAfter: event.result.estimatedTokensAfter }),
            summaryInputTokens: event.result?.usage?.input ?? 0,
            summaryOutputTokens: event.result?.usage?.output ?? 0,
            summaryCostUsd: event.result?.usage?.cost?.total ?? 0,
          },
          event.errorMessage === undefined ? undefined : { status: "error", error: { name: "CompactionFailed", message: event.errorMessage.slice(0, 300) } },
        );
        this.#compactionSpan = undefined;
        if (event.aborted) return;
        if (event.errorMessage === undefined) this.#compactions += 1;
        else if (/overflow/i.test(event.errorMessage)) this.#overflowFailed = true;
        // The summary is a model call of its own: its tokens and cost belong to the job and to its budget.
        this.#count(event.result?.usage);
        return;
      default:
        return;
    }
  }

  /** Adds one call's usage to the totals and stops the job when it passes its budget. */
  #count(usage: Usage | undefined): void {
    this.#inputTokens += usage?.input ?? 0;
    this.#outputTokens += usage?.output ?? 0;
    this.#cacheReadTokens += usage?.cacheRead ?? 0;
    this.#cacheWriteTokens += usage?.cacheWrite ?? 0;
    this.#costUsd += usage?.cost?.total ?? 0;
    const max = this.spec.limits.maxCostUsd;
    if (max !== undefined && this.#costUsd > max) void this.#halt("budget", `cost ${this.#costUsd.toFixed(4)} USD exceeded ${max} USD`);
  }

  /** Remembers how full the context window got. */
  #watchContext(): void {
    try {
      const percent = this.#session?.getContextUsage()?.percent;
      if (typeof percent === "number" && percent > this.#contextPeakPercent) this.#contextPeakPercent = percent;
    } catch {
      // a session that cannot say how full it is simply reports no peak
    }
  }

  #finish(): void {
    if (this.#stop !== undefined) return this.#end(this.#stop);
    const stopReason = this.#last?.stopReason;
    if (this.#last === undefined) return this.#end({ reason: "error", error: "the model returned no response" });
    if (stopReason === "error") {
      const message = this.#last.errorMessage ?? "model error";
      if (this.#overflowFailed || isContextOverflow(this.#last as unknown as AssistantMessage)) {
        return this.#end({ reason: "context-overflow", error: `the conversation outgrew the model's context window and compacting it did not help: ${message}` });
      }
      return this.#end({ reason: "error", error: message });
    }
    if (stopReason === "aborted") return this.#end({ reason: "aborted", error: this.#last.errorMessage ?? "aborted" });
    if (stopReason === "length") return this.#end({ reason: "error", error: "the response hit the model's output token limit" });
    this.#end(undefined);
  }

  #emitSpan(span: JobSpan): void {
    this.events.push({ type: "span", jobId: this.jobId, span });
  }

  /** Closes the turn's span with what the turn cost. */
  #endTurn(): void {
    if (this.#turnSpan === undefined) return;
    const usage = this.#turnUsage;
    const percent = this.#contextPercent();
    this.#turnSpan.end({
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      costUsd: usage.cost,
      ...(usage.stopReason === "" ? {} : { stopReason: usage.stopReason }),
      ...(percent === undefined ? {} : { contextPercent: Math.round(percent * 10) / 10 }),
    });
    this.#turnSpan = undefined;
  }

  #contextPercent(): number | undefined {
    try {
      const percent = this.#session?.getContextUsage()?.percent;
      return typeof percent === "number" ? percent : undefined;
    } catch {
      return undefined;
    }
  }

  /** A tool call is a span under its turn, or under the call that made it (codemode runs other tools). */
  #beginTool(callId: string, tool: string, parentCallId: string | undefined): void {
    const outer = parentCallId ?? (callId.includes("/") ? callId.slice(0, callId.lastIndexOf("/")) : undefined);
    if (outer !== undefined) this.#nestedCalls.set(outer, (this.#nestedCalls.get(outer) ?? 0) + 1);
    const parent = (outer === undefined ? undefined : this.#toolSpans.get(outer)) ?? this.#turnSpan ?? this.#root;
    const mcp = tool.startsWith("mcp__");
    const name = mcp ? "kintsugi.mcp" : tool === "codemode" ? "kintsugi.codemode" : "kintsugi.tool";
    this.#toolSpans.set(
      callId,
      beginSpan(parent.span, name, { tool, ...(outer === undefined ? {} : { nested: true }), ...(mcp ? { server: tool.split("__")[1] ?? "" } : {}) }),
    );
  }

  #endTool(callId: string, ok: boolean, executeMs: number | undefined): void {
    const span = this.#toolSpans.get(callId);
    if (span === undefined) return;
    this.#toolSpans.delete(callId);
    const nested = this.#nestedCalls.get(callId);
    span.end(
      { ok, ...(executeMs === undefined ? {} : { executeMs }), ...(nested === undefined ? {} : { nestedCalls: nested }) },
      ok ? undefined : { status: "error", error: { name: "ToolError", message: "the tool reported an error" } },
    );
  }

  /** Settles every open span, the root last, with how the job ended. */
  #closeSpans(failure: { reason: JobFailureReason; error: string } | undefined): void {
    for (const span of this.#toolSpans.values()) span.end({ ok: false, ended: "job" });
    this.#toolSpans.clear();
    this.#compactionSpan?.end({ ended: "job" });
    this.#retrySpan?.end({ ended: "job" });
    this.#endTurn();
    this.#root.end(
      {
        turns: this.#turns,
        inputTokens: this.#inputTokens,
        outputTokens: this.#outputTokens,
        cacheReadTokens: this.#cacheReadTokens,
        cacheWriteTokens: this.#cacheWriteTokens,
        costUsd: this.#costUsd,
        compactions: this.#compactions,
        contextPeakPercent: Math.round(this.#contextPeakPercent * 10) / 10,
        outcome: failure?.reason ?? "completed",
      },
      failure === undefined ? undefined : { status: "error", error: { name: failure.reason, message: failure.error.slice(0, 300) } },
    );
  }

  #end(failure: { reason: JobFailureReason; error: string } | undefined): void {
    if (this.#ended) return;
    this.#ended = true;
    void this.#finalize(failure);
  }

  /** Settles the spans first, so every `span` event precedes `usage` and the end event. */
  async #finalize(failure: { reason: JobFailureReason; error: string } | undefined): Promise<void> {
    this.#closeSpans(failure);
    await this.#telemetry.whenIdle();
    this.events.push({
      type: "usage",
      jobId: this.jobId,
      model: `${this.spec.model.provider}/${this.spec.model.id}`,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      costUsd: this.#costUsd,
      cacheReadTokens: this.#cacheReadTokens,
      cacheWriteTokens: this.#cacheWriteTokens,
      turns: this.#turns,
      compactions: this.#compactions,
      contextPeakPercent: Math.round(this.#contextPeakPercent * 10) / 10,
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
