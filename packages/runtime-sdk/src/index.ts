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
  /** Maximum assistant turns (one LLM response plus its tool calls). */
  maxTurns?: number;
  maxCostUsd?: number;
}

export interface JobSpec {
  agent: AgentDefinition;
  /** The user prompt for this job. */
  task: string;
  /** provider refers to an LlmProviderConfig id; thinking overrides the agent's default. */
  model: { provider: string; id: string; thinking?: ThinkingLevel };
  workspace: {
    /** Directories the agent may read; the first one is its working directory. */
    readOnly: string[];
    /** The only directory the agent may write to. */
    outDir: string;
  };
  limits: JobLimits;
  /** Opaque correlation data (e.g. projectId, trigger), echoed on job.started; never shown to the agent. */
  metadata?: Record<string, string>;
}

export type JobFailureReason = "error" | "timeout" | "max-turns" | "budget" | "aborted";

export type JobEvent =
  | { type: "job.started"; jobId: string; at: string; runtimeVersion: string; agent: string; metadata?: Record<string, string> }
  | { type: "message.delta"; jobId: string; text: string }
  /** Periodic sign of work while the model streams: characters so far per kind and the current turn. */
  | { type: "progress"; jobId: string; turn: number; thinkingChars: number; toolArgsChars: number; textChars: number }
  | { type: "tool.call"; jobId: string; callId: string; tool: string; input: unknown; decision: "allowed" | "blocked"; reason?: string }
  | { type: "tool.result"; jobId: string; callId: string; ok: boolean; summary?: string }
  | { type: "output"; jobId: string; path: string }
  | { type: "usage"; jobId: string; model: string; inputTokens: number; outputTokens: number; costUsd?: number }
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
  /** Identifies the underlying engine, e.g. "pi@1.1.0". */
  readonly engine: string;
  startJob(spec: JobSpec): Promise<JobHandle>;
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

/** A provider from pi-ai's built-in catalog (list is read from the pinned pi version). */
export interface BuiltinProviderConfig {
  kind: "builtin";
  id: string; // Kintsugi id, unique per installation
  piProvider: string; // pi provider id, e.g. "anthropic", "openai", "amazon-bedrock"
  auth: ProviderAuth;
  /** pi `modelOverrides` for built-in models (sampling, prompt cache, input limits…). */
  modelOverrides?: Record<string, Record<string, unknown>>;
  enabledModels?: string[]; // allowlist; empty = all catalog models
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
