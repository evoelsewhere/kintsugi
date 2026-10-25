// Contract for the Kintsugi Runtime: a generic agent kernel on pi (ADR-0023). It runs
// one agent job at a time and knows no agent or use case: the job carries the whole
// agent definition, the task, the model and the limits. Sources are read-only; the job
// writes only to its output directory, and the caller decides what happens to the files
// (ADR-0004, ADR-0007).

import type { ThinkingLevel } from "@kintsugi/domain";

/** A skill: extra instructions loaded into the agent's system prompt. */
export interface AgentSkill {
  /** Lowercase identifier, e.g. "review-checklist" ([a-z][a-z0-9-]*). */
  name: string;
  content: string;
  /**
   * Supporting files of the skill (`references/…`), by path relative to the skill folder. The host
   * that starts the job writes them somewhere the agent can read and replaces this with `supporting`.
   */
  files?: Record<string, string>;
  /** Where the host put the skill's supporting files (a read-only directory) and their relative paths. */
  supporting?: { dir: string; paths: string[] };
}

/** A complete agent, supplied with every job. Nothing about agents is stored in the runtime. */
export interface AgentDefinition {
  id: string;
  version: string;
  /** System prompt, used verbatim. */
  instructions: string;
  skills?: AgentSkill[];
  /** Tool allowlist by name (see the kernel tool registry); [] = no tools. */
  tools: string[];
  /** Regular expressions; matching shell commands are blocked before they run. */
  denyCommandPatterns?: string[];
  thinking?: ThinkingLevel;
}

export interface JobLimits {
  timeoutSec: number;
  /**
   * Seconds without a sign of life from the model before the job counts as stalled and is stopped; 0 turns the
   * watchdog off. Absent: the launcher's own default.
   */
  idleTimeoutSec?: number;
  /** Maximum assistant turns (one LLM response plus its tool calls). */
  maxTurns?: number;
  maxCostUsd?: number;
}

/**
 * An MCP server a job may use (ADR-0047): an HTTP endpoint the admin registered. The job gets it only when
 * the agent names it in `tools` (`mcp__<server>__*`). The headers are decrypted by the worker and travel on
 * the job child's stdin, never in its environment or in an event.
 */
export interface McpServerSpec {
  /** The server's id; its tools are `mcp__<id>__<tool>` (dashes of the id written as `_`). */
  name: string;
  url: string;
  headers: Record<string, string>;
  /** Per-request timeout, seconds. */
  timeoutSec: number;
  description?: string;
  /** Tool-name patterns (`*` matches any characters) allowed besides the tools the server marks read-only. */
  allowedTools: string[];
}

/** A live, caller-bound memory service. Scope and credentials stay in the host process. */
export type MemoryOperation = "search" | "read" | "write" | "status" | "forget" | "restore" | "scratchpad";
export const memoryToolName = (operation: MemoryOperation): string => operation === "scratchpad" ? "scratchpad" : `memory_${operation}`;
/** A caller-authored, safe tool error. Other backend errors must not be exposed to the model. */
export class JobServiceRequestError extends Error {}
export class MemoryRequestError extends JobServiceRequestError {}
export class WebSearchRequestError extends JobServiceRequestError {}
export interface JobServices {
  webSearch?: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
  memory?: (operation: MemoryOperation, input: unknown, signal?: AbortSignal) => Promise<unknown>;
}

export interface JobSpec {
  agent: AgentDefinition;
  /** The user prompt for this job. */
  task: string;
  /** provider refers to an LlmProviderConfig id; thinking overrides the agent's default. */
  model: { provider: string; id: string; thinking?: ThinkingLevel };
  workspace: {
    /** The job workspace (ADR-0055): the agent's working directory, so a relative path is read against it. */
    root: string;
    /**
     * Directories and files the agent may read, in the order the kernel offers them: the first directory is
     * where a search without a path looks (the as-is code). Paths are absolute; the agent sees them relative to `root`.
     */
    readOnly: string[];
    /** The only directory the agent may write to. */
    outDir: string;
  };
  limits: JobLimits;
  /**
   * The JSON Schema of the structured result this job must report. The agent gets a `submit_result` tool whose
   * parameters are this schema (validated before it runs) and the result is written as `result.json` in `outDir`.
   */
  resultSchema?: Record<string, unknown>;
  /** Enables optional memory tools backed by the caller; carries no memory content or database credentials. */
  memory?: { writeSchema?: Record<string, unknown> };
  /** Explicit outbound search grant; no provider credentials or search results. */
  webSearch?: true;
  /** The MCP servers the agent names in `tools`; absent when it names none. */
  mcp?: { servers: McpServerSpec[] };
  /** Opaque correlation data (e.g. projectId, trigger), echoed on job.started; never shown to the agent. */
  metadata?: Record<string, string>;
}

/** `context-overflow`: the conversation outgrew the model's window and compaction could not recover it. */
export type JobFailureReason = "error" | "timeout" | "max-turns" | "budget" | "aborted" | "context-overflow";

/**
 * One settled unit of work inside a job (ADR-0048), shaped by the `pi-telemetry` contract:
 * `kintsugi.job` (the root), `kintsugi.turn`, `kintsugi.tool`, `kintsugi.compaction`,
 * `kintsugi.retry`, `kintsugi.codemode` and `kintsugi.mcp`. Attributes are scalars only.
 */
export interface JobSpan {
  id: string;
  parentId?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
  attributes: Record<string, string | number | boolean>;
}

export type JobEvent =
  | { type: "job.started"; jobId: string; at: string; runtimeVersion: string; agent: string; metadata?: Record<string, string> }
  | { type: "message.delta"; jobId: string; text: string }
  /** Periodic sign of work while the model streams: characters so far per kind and the current turn. */
  | { type: "progress"; jobId: string; turn: number; thinkingChars: number; toolArgsChars: number; textChars: number }
  | { type: "tool.call"; jobId: string; callId: string; tool: string; input: unknown; decision: "allowed" | "blocked"; reason?: string }
  | { type: "tool.result"; jobId: string; callId: string; ok: boolean; summary?: string; durationMs?: number }
  | { type: "output"; jobId: string; path: string }
  /** Totals of the job, summarisation included. Cache tokens are not part of `inputTokens`. */
  | {
      type: "usage";
      jobId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      turns?: number;
      /** Times the conversation was compacted. */
      compactions?: number;
      /** The highest share of the model's context window the conversation reached, 0-100. */
      contextPeakPercent?: number;
    }
  | { type: "span"; jobId: string; span: JobSpan }
  | { type: "job.completed"; jobId: string; at: string; summary: string }
  | { type: "job.failed"; jobId: string; at: string; reason: JobFailureReason; error: string };

export interface JobHandle {
  jobId: string;
  events: AsyncIterable<JobEvent>;
  /** Sends another user message to a job that is still running (interactive agents). */
  followUp?(message: string): Promise<void>;
  abort(reason: string): Promise<void>;
  /** Resolves with the final event; never rejects. */
  done: Promise<Extract<JobEvent, { type: "job.completed" | "job.failed" }>>;
}

export interface AgentRuntime {
  /** Identifies the underlying engine, e.g. "pi@1.3.0". */
  readonly engine: string;
  startJob(spec: JobSpec, services?: JobServices): Promise<JobHandle>;
}

// ---------------------------------------------------------------------------
// LLM provider registry for the runtime (ADR-0009). Mirrors what pi supports;
// the launcher registers it with pi in memory and passes credentials at runtime.
// ---------------------------------------------------------------------------

/** Credentials are stored encrypted in Postgres; only references travel in configs. */
export type SecretRef = { secretId: string };

export type ProviderAuth =
  | { type: "api-key"; key: SecretRef }
  /** Provider-specific environment, e.g. Azure base URL / API version / deployment map,
   *  Vertex project + location, Bedrock region + keys. Secret values use SecretRef. */
  | { type: "env"; vars: Record<string, string | SecretRef> }
  | { type: "service-account-json"; file: SecretRef; envVar: string }
  | { type: "none" };

/**
 * How long a provider keeps a prompt cached (ADR-0048): `short` (about 5 minutes, renewed by every hit; the
 * default) or `long` (about an hour; written at a higher price, worth it when jobs of one agent are minutes
 * apart). pi reads it from `PI_CACHE_RETENTION`, which only knows `long`; there is no way to turn caching off.
 */
export type CacheRetention = "short" | "long";

/** A provider from pi-ai's built-in catalog (list is read from the pinned pi version). */
export interface BuiltinProviderConfig {
  kind: "builtin";
  id: string; // Kintsugi id, unique per installation
  piProvider: string; // pi provider id, e.g. "anthropic", "openai", "amazon-bedrock"
  auth: ProviderAuth;
  /** pi `modelOverrides` for built-in models (sampling, prompt cache, input limits…). */
  modelOverrides?: Record<string, Record<string, unknown>>;
  enabledModels?: string[]; // allowlist; empty = all catalog models
  cacheRetention?: CacheRetention;
}

/** A custom provider expressed in pi's models.json shape (vLLM, Ollama, LiteLLM, internal gateway…). */
export interface CustomProviderConfig {
  kind: "custom";
  id: string;
  /** pi wire protocol, e.g. "openai-completions", "openai-responses", "anthropic-messages",
   *  "google-generative-ai", "bedrock-converse-stream", "mistral-conversations". */
  api: string;
  baseUrl: string;
  auth: ProviderAuth;
  headers?: Record<string, string | SecretRef>;
  models: CustomModelConfig[];
  cacheRetention?: CacheRetention;
}

export interface CustomModelConfig {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** USD per million tokens; used for budgets and cost reporting. */
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  /** pi compat flags, e.g. { supportsDeveloperRole: false, supportsReasoningEffort: false }. */
  compat?: Record<string, boolean>;
}

export type LlmProviderConfig = BuiltinProviderConfig | CustomProviderConfig;

/** Which provider/model a runtime agent (by id) uses, optionally per project. */
export interface AgentModelBinding {
  agent: string;
  projectId?: string; // undefined = installation default
  provider: string; // LlmProviderConfig.id
  model: string;
  thinking?: ThinkingLevel;
}
