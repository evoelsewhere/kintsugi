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

/** Project roles, aligned with the reference RACI. */
export const ROLES = [
  "admin",
  "pm",
  "core-team",
  "architect",
  "ba",
  "dev",
  "qc",
  "ai-practice-owner",
  "ai-champion",
  "ai-engineer",
  "prompt-engineer",
  "km-lead",
  "km-engineer",
] as const;
export type Role = (typeof ROLES)[number];

export type Raci = "R" | "A" | "C" | "I";

/** Who performs a stage of a work item. */
export type Performer =
  // A project member, typically working through their own AI harness.
  | { kind: "member"; role: Role; harness?: MemberHarnessId }
  // A Kintsugi runtime agent (pi-based, server-side, never writes to project repos).
  | { kind: "runtime-agent"; agentId: RuntimeAgentId }
  | { kind: "tool"; toolId: string };

/** AI harnesses members use on their own machines to do the actual work. */
export const MEMBER_HARNESSES = ["claude-code", "copilot", "codex", "chatgpt"] as const;
export type MemberHarnessId = (typeof MEMBER_HARNESSES)[number];

/** Kintsugi's own agents, executed on the pi runtime. */
export const RUNTIME_AGENTS = [
  "knowledge-ingest",
  "kb-assistant",
  "assessment",
  "wave-planner",
  "to-be-analyst",
  "task-planner",
  "gate-reviewer",
  "insight",
] as const;
export type RuntimeAgentId = (typeof RUNTIME_AGENTS)[number];

/** Unit of migration work: a feature, screen, module, DB object, … */
export interface WorkItem {
  id: string;
  projectId: string;
  applicationId: string;
  kind: "feature" | "screen" | "module" | "api" | "db-object" | "job" | "infra";
  title: string;
  wave?: string;
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

/** A project has one workspace repo and any number of code repos, possibly on different servers. */
export interface Repository {
  id: string;
  serverId: string;
  path: string; // e.g. "org/app-legacy"
  role: "workspace" | "code";
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
  author?: string;
  reviewedBy?: string;
}

/** Quality gates G0–G6 plus per-work-item gates. */
export type GateId = "G0" | "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

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
