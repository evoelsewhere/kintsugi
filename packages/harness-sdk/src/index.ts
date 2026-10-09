// Contract for member harnesses (Claude Code, GitHub Copilot, Codex, ChatGPT) running
// on members' own machines. Kintsugi does not drive these harnesses; it supplies them
// with context (task packs, skills, MCP) and ingests what they produce (PRs,
// artifacts, telemetry). See docs/reference/harness-integration.md.

import type { MemberHarnessId, Role } from "@kintsugi/domain";

/** Context for one work item, prepared by the task-planner runtime agent. */
export interface TaskPack {
  workItemId: string;
  version: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  /** AS-IS excerpts and citations pulled from the KB. */
  context: { source: string; excerpt: string }[];
  relevantPaths: string[];
  rules: string[]; // architecture / coding rules that the gate-reviewer will check
  suggestedSkills: string[];
  /** Deliverables are committed to Git by the member, then registered (ADR-0007). */
  deliverables: { type: string; description: string; repo: "workspace" | "code"; path: string }[];
}

/** Canonical assets to render for a harness (ADR-0005). */
export interface AssetBundle {
  skills: { name: string; files: Map<string, string> }[];
  projectContext: string; // AGENTS.md content
  roles?: { role: Role; instructions: string }[];
  mcpServerUrl: string;
  taskPack?: TaskPack;
}

/** Renders canonical assets into a harness's native layout. */
export interface AssetRenderer {
  readonly harness: MemberHarnessId;
  /** Returns repo-relative (or user-config-relative) path → file content. */
  render(bundle: AssetBundle): Map<string, string>;
}

/** Normalized activity record ingested from any harness or from Kintsugi MCP/CLI. */
export interface HarnessActivity {
  at: string;
  projectId?: string;
  userId: string;
  harness: MemberHarnessId;
  source: "kintsugi-mcp" | "kintsugi-cli" | "otel" | "vendor-metrics-api" | "git";
  kind: "session" | "tool-use" | "kb-query" | "task-update" | "artifact-register" | "commit" | "pull-request";
  workItemId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Declared or measured AI share for commits/PRs/artifacts, 0–1. */
  aiShare?: number;
  attributes?: Record<string, string | number | boolean>;
}

/** Converts a raw payload from one telemetry source into normalized activities. */
export interface TelemetryNormalizer<Raw = unknown> {
  readonly harness: MemberHarnessId;
  readonly source: HarnessActivity["source"];
  normalize(raw: Raw, ctx: { projectId?: string }): HarnessActivity[];
}

/** Managed configuration Kintsugi distributes to a harness (allowed models, MCP, exclusions). */
export interface HarnessPolicy {
  harness: MemberHarnessId;
  allowedModels?: string[];
  allowedMcpServers: string[];
  contentExclusions?: string[]; // glob patterns the harness must not read/send
  requireCommitTrailer?: boolean; // e.g. "Assisted-by: claude-code"
}
