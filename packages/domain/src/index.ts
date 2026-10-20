// Core domain vocabulary shared by every Kintsugi module.
// Source of truth for the concepts described in docs/methodology/delivery-pipeline.md
// and docs/reference/data-model.md.

/** Pipeline phases P0–P7. */
export const PHASES = [
  "mobilize",
  "discover-assess",
  "define-to-be",
  "prepare-factory",
  "migrate",
  "verify",
  "cutover",
  "hypercare-operate",
] as const;
export type Phase = (typeof PHASES)[number];

/** 7R transformation strategy (Retire/Retain + the classic Rs + Repurchase). */
export const DISPOSITIONS = [
  "retire",
  "retain",
  "rehost",
  "replatform",
  "refactor",
  "rearchitect",
  "rebuild",
  "repurchase",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * Project roles: RACI responsibilities named in pipelines (stage performers, gate owners).
 * Not access roles (ADR-0024). The well-known ones are those the starter document repo
 * uses; a project may name its own (open set).
 */
export const WELL_KNOWN_PROJECT_ROLES = ["pm", "core-team", "architect", "ba", "dev", "qc", "ai-champion"] as const;
export type ProjectRole = (typeof WELL_KNOWN_PROJECT_ROLES)[number] | (string & {});

/** Who performs a stage of a work item. */
export type Performer =
  // A project member, typically working through their own AI harness.
  | { kind: "member"; role: ProjectRole; harness?: MemberHarnessId }
  // A Kintsugi runtime agent (pi-based, server-side, never writes to project repos).
  | { kind: "runtime-agent"; agentId: RuntimeAgentId }
  | { kind: "tool"; toolId: string };

/** AI harnesses members use on their own machines to do the actual work. */
/** Harnesses with built-in renderers. The id is open: installations and projects can register more (ADR-0013). */
export const MEMBER_HARNESSES = ["claude-code", "copilot", "codex", "chatgpt"] as const;
export type MemberHarnessId = (typeof MEMBER_HARNESSES)[number] | (string & {});

/** Id of a runtime agent. Open: agents are data supplied with each job, none ships with Kintsugi (ADR-0023). */
export type RuntimeAgentId = string;

/** Reasoning effort for a runtime agent's model (mirrors pi's thinking levels). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Work item status as stored in the unit file frontmatter. */
export const WORK_ITEM_STATUSES = ["pending", "in-progress", "awaiting-review", "approved", "rejected", "blocked", "done", "skipped"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/**
 * Frontmatter of the unit-state path returned by `unitStatePath` in the document repo (ADR-0012, ADR-0028).
 * This file is the source of truth; Postgres only indexes it.
 */
export interface WorkItemFile {
  id: string; // "<application>/<module>/<unit>"
  application: string;
  module: string;
  kind: string; // one of the unit kinds declared in kintsugi.yaml
  title: string;
  wave?: number | string;
  pilot?: boolean;
  phase: Phase;
  stage?: string;
  status: WorkItemStatus;
  assignee?: string;
  harness?: MemberHarnessId;
  complexity?: "low" | "medium" | "high";
  dependsOn?: string[];
  source?: { repo: string; paths: string[] }[];
  target?: { repo: string; paths: string[] }[];
  /** Authoritative declarations only; never inferred from prose or observed pull requests. */
  requiredDeliverables?: { id: string; repositoryId: string; path: string }[];
  links?: {
    taskPack?: string;
    asIs?: string;
    mappings?: string[];
    businessRules?: string[];
    pullRequests?: string[];
  };
  gates?: Partial<Record<GateId | string, { status: "pending" | "approved" | "rejected"; by?: string; at?: string; review?: string }>>;
}

/** Index row derived from a unit file; rebuildable from Git. */
export interface WorkItem extends WorkItemFile {
  projectId: string;
  file: GitLocation;
  stages: StageRun[];
}

export type StageStatus =
  | "pending"
  | "running"
  | "awaiting-review"
  | "approved"
  | "rejected"
  | "failed"
  | "skipped";

export interface StageRun {
  stage: string; // e.g. "reverse-design", "code-migrate", "ut-gen", "compare-test"
  phase: Phase;
  performer: Performer;
  status: StageStatus;
  artifacts: ArtifactRef[];
  /** Runtime job (pi) that prepared or reviewed this stage. */
  runtimeJobId?: string;
  /** Pull request where a member delivered this stage. */
  pullRequestUrl?: string;
}

/** Artifacts live in Git (ADR-0007); Kintsugi only records where and how they were produced. */
export interface ArtifactRef {
  id: string;
  type: string; // e.g. "detail-design", "source-diff", "test-report", "scorecard"
  location: GitLocation;
  provenance: Provenance;
}

export interface GitLocation {
  repo: string; // repository URL
  commit: string;
  path: string;
}

/** An installation can register many Git servers of different kinds (ADR-0007). */
export const GIT_SERVER_KINDS = [
  "github",
  "github-enterprise",
  "azure-devops",
  "gitlab",
  "bitbucket",
  "gitea",
  "plain-git", // clone/fetch/push + branch polling only, no PR API
] as const;
export type GitServerKind = (typeof GIT_SERVER_KINDS)[number];

export interface GitServer {
  id: string;
  kind: GitServerKind;
  baseUrl: string;
  credentialRef: string;
}

/**
 * Repository roles (ADR-0028). `document`: the project's single document repo (everything
 * except code). AS-IS, read-only for Kintsugi: `legacy` (code) and `legacy-data` (data).
 * TO-BE: `target`, written only by members, one per architecture component.
 */
export const REPOSITORY_ROLES = ["legacy", "legacy-data", "document", "target"] as const;
export type RepositoryRole = (typeof REPOSITORY_ROLES)[number];

/** A project has one document repo and, per application, any number of legacy, legacy-data and target repos, possibly on different servers. */
export interface Repository {
  id: string;
  serverId: string;
  path: string; // e.g. "org/app-legacy"
  role: RepositoryRole;
  /** Architecture component a `target` repo implements. */
  component?: string;
  defaultBranch: string;
  credentialRef?: string; // overrides the server credential
}

/** Every artifact records whether, and how, AI produced it — feeds the AI metrics. */
export interface Provenance {
  origin: "human" | "human-with-ai" | "runtime-agent" | "tool";
  /** Set when origin is "human-with-ai". */
  harness?: MemberHarnessId;
  /** Set when origin is "runtime-agent". */
  runtimeAgent?: RuntimeAgentId;
  model?: string;
  /** Declared or measured share of AI-generated content, 0–1. */
  aiShare?: number;
  assetVersion?: string; // skill / task-pack template version used
  /** Document repo commit the artifact was produced against. */
  documentRepoCommit?: string;
  author?: string;
  reviewedBy?: string;
}

/** Quality gates G0–G6 plus per-work-item gates. */
export type GateId = "G0" | "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

/** The pipeline gates, in order (docs/methodology/delivery-pipeline.md). */
export const GATE_IDS: readonly GateId[] = ["G0", "G1", "G2", "G3", "G4", "G5", "G6"];

/**
 * A gate key: a pipeline gate (G0–G6) or a stage gate such as `stage:assess` — lowercase,
 * starting with a letter or digit, up to 100 characters.
 */
export const GATE_KEY_PATTERN = /^(G[0-6]|[a-z0-9][a-z0-9:._-]{0,99})$/;

/** The state of a persisted gate: waiting for a decision, or decided. */
export type GateStatus = "pending" | "approved" | "rejected" | "waived";
export const GATE_STATUSES: readonly GateStatus[] = ["pending", "approved", "rejected", "waived"];

/** What a person decides on a pending gate; each decision leads to one final status. */
export type GateDecision = "approve" | "reject" | "waive";
export const GATE_DECISION_STATUS: Readonly<Record<GateDecision, Exclude<GateStatus, "pending">>> = { approve: "approved", reject: "rejected", waive: "waived" };

/** Transformation scorecard. Weights sum to 1. */
export interface ScorecardCriterion {
  key: string;
  group: "business" | "technical" | "feasibility" | "cost" | "risk";
  weight: number;
  score?: number; // 1–10
}

export function weightedScore(criteria: ScorecardCriterion[]): number {
  return criteria.reduce((sum, c) => sum + c.weight * (c.score ?? 0), 0);
}

/** Total weighted score → priority band and candidate dispositions. */
export function recommendDispositions(total: number): {
  priority: "low" | "medium" | "high";
  candidates: Disposition[];
} {
  if (total >= 7) return { priority: "low", candidates: ["retain", "rehost"] };
  if (total >= 4) return { priority: "medium", candidates: ["rehost", "refactor"] };
  return {
    priority: "high",
    candidates: ["retire", "rearchitect", "rebuild", "repurchase"],
  };
}

// ---------------------------------------------------------------------------
// Application pipelines (ADR-0028). Declared directly in the document repo's kintsugi.yaml,
// or chosen from the built-in pipelines.

export type StagePerformer =
  | { agent: RuntimeAgentId } // a runtime agent by id (ADR-0023)
  | { member: ProjectRole[] };

export interface PipelineDefinition {
  id: string;
  appliesTo?: { dispositions?: Disposition[] };
  phases: {
    id: Phase | (string & {});
    /** Required for custom phases: built-in phase used for reporting. */
    category?: Phase;
    perUnit?: boolean;
    stages: { id: string; performer: StagePerformer; gate?: GateId | (string & {}) }[];
  }[];
  gates?: Record<string, { require: string[] }>;
}

/** Standard compare report contract, produced by the built-in compare engine. */
export interface CompareReport {
  verdict: "pass" | "fail";
  diffCount: number;
  clusters: { id: string; files: string[]; summary: string }[];
  reportPath: string;
}

// Projects and the kintsugi.yaml manifest (ADR-0028).
export * from "./project.js";
export * from "./validation.js";
export * from "./member-task.js";
export * from "./gate-evidence.js";
export * from "./manifest.js";

// Application and per-unit document-repo paths (ADR-0038), with catalog vocabulary (ADR-0033).
export * from "./document-layout.js";
export * from "./catalog.js";
export * from "./traceability.js";
