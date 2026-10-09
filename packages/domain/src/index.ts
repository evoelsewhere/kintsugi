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
  | { kind: "runner"; runnerId: string; pack: string }
  | { kind: "tool"; toolId: string };

/** AI harnesses members use on their own machines to do the actual work. */
/** Harnesses with built-in renderers. The id is open: installations and projects can register more (ADR-0013). */
export const MEMBER_HARNESSES = ["claude-code", "copilot", "codex", "chatgpt"] as const;
export type MemberHarnessId = (typeof MEMBER_HARNESSES)[number] | (string & {});

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

/** Reasoning effort for a runtime agent's model binding (mirrors pi's thinking levels). */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Work item status as stored in the unit file frontmatter. */
export type WorkItemStatus =
  | "pending"
  | "in-progress"
  | "awaiting-review"
  | "approved"
  | "rejected"
  | "blocked"
  | "done"
  | "skipped";

/**
 * Frontmatter of `units/<application>/<module>/<unit>.md` in the workspace repo (ADR-0012).
 * This file is the source of truth; Postgres only indexes it.
 */
export interface WorkItemFile {
  id: string; // "<application>/<module>/<unit>"
  application: string;
  module: string;
  kind: string; // one of the rulebook's units.kinds
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
  links?: {
    taskPack?: string;
    asIs?: string;
    mappings?: string[];
    uiPatterns?: string[];
    businessRules?: string[];
    pullRequests?: string[];
  };
  gates?: Partial<Record<GateId | string, { status: "pending" | "approved" | "rejected"; by?: string; at?: string; review?: string }>>;
  /** Packs resolved for this unit (defaults + application packs). */
  packs?: string[];
  /** Rule IDs applied when the unit was last planned / reviewed; drives impact analysis. */
  rulesApplied?: string[];
  /** Set when a rule in `rulesApplied` changed after the unit was processed. */
  stale?: { since: string; rules: string[] };
  /** Waivers relied on by the last run, if any. */
  waivers?: string[];
  rulebook?: RulebookRef;
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

/** A project has one workspace repo and any number of source (read-only) and target repos, possibly on different servers. */
export interface Repository {
  id: string;
  serverId: string;
  path: string; // e.g. "org/app-legacy"
  role: "workspace" | "source" | "target";
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
  rulebook?: RulebookRef;
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

// ---------------------------------------------------------------------------
// Project rulebook (ADR-0011, ADR-0013). Lives in the workspace repo under rulebook/;
// these types mirror rulebook.yaml / pack.yaml / pipelines/*.yaml / waivers (schemaVersion 1, draft).
// JSON Schema for rulebook files is generated from these types. Unknown `x-*` keys are allowed.
// ---------------------------------------------------------------------------

/** Capabilities Kintsugi knows about; rulebooks may declare custom ones (open set). */
export const WELL_KNOWN_CAPABILITIES = [
  "understand",
  "conventions",
  "mapping",
  "convert",
  "review",
  "compare",
  "cutover",
] as const;
export type CapabilityName = (typeof WELL_KNOWN_CAPABILITIES)[number] | (string & {});

/** template → draft → ready; `suspended` blocks a capability that was found wrong. */
export type CapabilityMaturity = "template" | "draft" | "ready" | "suspended";

export interface ScopedMaturity {
  default: CapabilityMaturity;
  byKind?: Record<string, CapabilityMaturity>;
  byApplication?: Record<string, CapabilityMaturity>;
}

export interface CapabilityDecl {
  maturity: CapabilityMaturity | ScopedMaturity;
  uses: string[];
  /** Units, reviews or eval results supporting the current maturity. */
  evidence?: string[];
}

export interface RulebookRef {
  version: string;
  /** Workspace-repo commit the rulebook was read from. */
  commit?: string;
}

export interface StackSpec {
  name: string;
  version?: string;
  frameworks?: string[];
}

export interface RunnerSpec {
  /** Container image; must match the installation image allowlist. */
  image: string;
  command: string[];
  resources?: { cpus?: number; memory?: string; timeoutSec?: number };
  network?: "none" | "allowlist";
}

export interface PackManifest {
  id: string;
  version?: string; // present on vendored packs
  description?: string;
  stacks: { source: StackSpec[]; target: StackSpec[] };
  /** Unit kinds only; unit files are declared or agent-proposed in units/** (ADR-0014). */
  units: { kinds: string[] };
  capabilities: Record<CapabilityName, CapabilityDecl>;
  runners?: Record<string, RunnerSpec>;
  compare?: { defaultProfile?: string; comparators?: Record<string, string> };
}

export interface RulebookManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  owners: Role[];
  extends?: {
    id: string;
    version: string;
    source: string;
    path: string; // vendor/<id>@<version>
    /** The project's own maturity for vendored capabilities (default draft). */
    capabilities?: Record<CapabilityName, Omit<CapabilityDecl, "uses"> & { uses?: string[] }>;
  }[];
  packs: string[];
  /** Registry of custom capabilities (well-known ones need no entry). */
  capabilities?: Record<string, { description: string }>;
  pipelines: string[];
  harnesses?: string[];
}

export interface Waiver {
  id: string; // W-###
  capability: CapabilityName;
  packs?: string[];
  scope: { kinds?: string[]; units?: string[]; applications?: string[] };
  reason: string;
  approvedBy: Role[];
  expires: string; // ISO date, inclusive
}

export type StagePerformer =
  | { agent: RuntimeAgentId } // built-in agents only; fixed in code (ADR-0014)
  | { member: Role[] }
  | { runner: string; then?: "compare" };

export interface PipelineDefinition {
  id: string;
  appliesTo?: { dispositions?: Disposition[] };
  phases: {
    id: Phase | (string & {});
    /** Required for custom phases: built-in phase used for reporting. */
    category?: Phase;
    perUnit?: boolean;
    stages: { id: string; performer: StagePerformer; requires?: CapabilityName[]; gate?: GateId | (string & {}) }[];
  }[];
  gates?: Record<string, { require: string[] }>;
}

/** Frontmatter of mappings, UI patterns and review rules (one rule per file). */
export interface RuleFrontmatter {
  id: string;
  title: string;
  appliesTo?: { kinds?: string[]; packs?: string[]; applications?: string[]; globs?: string[] };
  severity?: "block" | "warn";
  check?: string[];
  relatesTo?: string[];
}

/** One layer providing a capability for a unit, after composition (vendor → packs → overrides). */
export interface CapabilityProvider {
  layer: string; // e.g. "vendor/org-baseline@2.1.0", "packs/webforms-to-aspnetcore"
  decl: CapabilityDecl;
}

export interface UnitScope {
  id: string;
  kind: string;
  application: string;
  pilot?: boolean;
}

export function resolveMaturity(
  maturity: CapabilityMaturity | ScopedMaturity,
  unit: Pick<UnitScope, "kind" | "application">,
): CapabilityMaturity {
  if (typeof maturity === "string") return maturity;
  return maturity.byApplication?.[unit.application] ?? maturity.byKind?.[unit.kind] ?? maturity.default;
}

function waiverCovers(w: Waiver, capability: CapabilityName, layer: string, unit: UnitScope, today: string): boolean {
  if (w.capability !== capability || w.expires < today) return false;
  if (w.packs?.length && !w.packs.some((p) => layer === p || layer.endsWith("/" + p))) return false;
  const { kinds, units, applications } = w.scope;
  if (units?.length) return units.includes(unit.id);
  if (applications?.length && !applications.includes(unit.application)) return false;
  return !kinds?.length || kinds.includes(unit.kind);
}

export interface ReadinessResult {
  ok: boolean;
  missing: { capability: CapabilityName; layer?: string; maturity?: CapabilityMaturity }[];
  waived: { capability: CapabilityName; layer: string; waiver: string }[];
}

/**
 * Can a stage requiring `required` run for `unit`? Every provider of every required capability
 * must allow it: `ready`, or `draft` for pilot units; otherwise a valid (non-expired) waiver must
 * cover it. `suspended` can never be waived. Capabilities with no provider are reported as missing.
 */
export function checkReadiness(
  providers: Record<CapabilityName, CapabilityProvider[]>,
  required: CapabilityName[],
  unit: UnitScope,
  waivers: Waiver[] = [],
  today: string = new Date().toISOString().slice(0, 10),
): ReadinessResult {
  const result: ReadinessResult = { ok: true, missing: [], waived: [] };
  for (const capability of required) {
    const list = providers[capability] ?? [];
    if (list.length === 0) {
      result.missing.push({ capability });
      continue;
    }
    for (const { layer, decl } of list) {
      const maturity = resolveMaturity(decl.maturity, unit);
      if (maturity === "ready" || (maturity === "draft" && unit.pilot)) continue;
      const waiver =
        maturity === "suspended" ? undefined : waivers.find((w) => waiverCovers(w, capability, layer, unit, today));
      if (waiver) result.waived.push({ capability, layer, waiver: waiver.id });
      else result.missing.push({ capability, layer, maturity });
    }
  }
  result.ok = result.missing.length === 0;
  return result;
}
