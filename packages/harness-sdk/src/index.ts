// Contract for member harnesses (Claude Code, GitHub Copilot, Codex, ChatGPT, …) running
// on members' own machines. Kintsugi does not drive these harnesses; it supplies them
// with context through agent plugins (skills, agents, hooks, MCP — ADR-0015) and task
// packs, and ingests what they produce (PRs, artifacts, telemetry).
// See docs/reference/harness-integration.md.

import type { MemberHarnessId, RuleFrontmatter, RulebookRef } from "@kintsugi/domain";

/** Context for one work item, prepared by the task-planner runtime agent. */
export interface TaskPack {
  workItemId: string;
  version: string;
  /** Rulebook the task pack was generated with; mappings / UI patterns / review rules are cited by ID. */
  rulebook: RulebookRef;
  packs: string[];
  /** Only the rules whose `appliesTo` matches this unit, with the layer each came from. */
  rulesApplied: (Pick<RuleFrontmatter, "id" | "title" | "severity"> & { layer: string; path: string })[];
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  /** AS-IS excerpts and citations pulled from the KB. */
  context: { source: string; excerpt: string }[];
  relevantPaths: string[];
  /** Skills (namespaced `<plugin>:<skill>`) from the published plugins that fit this unit. */
  suggestedSkills: string[];
  /** Deliverables are committed to Git by the member, then registered (ADR-0007). */
  deliverables: { type: string; description: string; repo: "workspace" | "target"; path: string }[];
}

// ---------------------------------------------------------------------------
// Agent plugins (ADR-0015). Canonical format = Claude Code plugin format.
// ---------------------------------------------------------------------------

/** Subset of `.claude-plugin/plugin.json` that Kintsugi reads, validates and generates. */
export interface PluginManifest {
  name: string; // kebab-case; project plugins prefixed with the project id
  displayName?: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  keywords?: string[];
  dependencies?: (string | { name: string; marketplace?: string; version?: string })[];
  userConfig?: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "directory" | "file";
      title: string;
      description: string;
      required?: boolean;
      sensitive?: boolean;
      default?: string | number | boolean | string[];
    }
  >;
}

/** A plugin Kintsugi publishes for a project. */
export interface PublishedPlugin {
  manifest: PluginManifest;
  origin: "builtin" | "rulebook";
  /** Rulebook layer for project plugins, e.g. "packs/webforms-to-aspnetcore". */
  layer?: string;
  /** Path inside the workspace repo, relative to its root (vendored built-in or rulebook pack). */
  path: string;
  /** `convert` maturity decides publication: ready → everyone, draft → pilot units only. */
  audience: "all" | "pilot";
}

/** Generated marketplace file (`.claude-plugin/marketplace.json` shape). */
export interface MarketplaceFile {
  name: string;
  owner: { name: string; email?: string; url?: string };
  description?: string;
  plugins: { name: string; source: string; description?: string; version?: string; category?: string; tags?: string[] }[];
}

/** How a harness consumes plugins. Re-verify vendor specifics when implementing generators. */
export interface HarnessPluginSupport {
  harness: MemberHarnessId;
  /** native = reads the Claude Code plugin format; converted = Kintsugi generates the vendor manifest; none = fallback renderer. */
  plugins: "native" | "converted" | "none";
  hooks: "full" | "command-only" | "none";
  /** Marketplace files Kintsugi generates in the workspace repo for this harness. */
  marketplaceFiles: string[];
}

export const BUILTIN_HARNESS_SUPPORT: HarnessPluginSupport[] = [
  { harness: "claude-code", plugins: "native", hooks: "full", marketplaceFiles: [".claude-plugin/marketplace.json"] },
  { harness: "copilot", plugins: "native", hooks: "full", marketplaceFiles: [".github/plugin/marketplace.json", ".claude-plugin/marketplace.json"] },
  { harness: "codex", plugins: "converted", hooks: "command-only", marketplaceFiles: [".agents/plugins/marketplace.json"] },
  { harness: "chatgpt", plugins: "none", hooks: "none", marketplaceFiles: [] },
];

/** Generates marketplace files (and converted manifests) for the published plugins. */
export interface MarketplaceGenerator {
  readonly harness: MemberHarnessId;
  /** Returns workspace-repo-relative path → file content. */
  generate(plugins: PublishedPlugin[], project: { id: string; name: string }): Map<string, string>;
}

/**
 * Fallback renderer config for harnesses without plugin support (built-in, installation-level,
 * or rulebook `harnesses/*.yaml`). Flattens plugin skills / agents / MCP into native paths;
 * hooks cannot be rendered. `format` names a transformer (ADR-0013, ADR-0015).
 */
export interface HarnessRendererConfig {
  id: MemberHarnessId;
  displayName: string;
  render: Partial<Record<"skills" | "projectContext" | "roles" | "mcp" | "taskPack", { path: string; format: string }>>;
  telemetry?: HarnessActivity["source"][];
}

/** Renders published plugins into a harness's native layout (fallback path only). */
export interface AssetRenderer {
  readonly harness: MemberHarnessId;
  /** Returns repo-relative (or user-config-relative) path → file content. */
  render(input: { plugins: PublishedPlugin[]; projectContext: string; mcpServerUrl: string; taskPack?: TaskPack }): Map<string, string>;
}

// ---------------------------------------------------------------------------
// Telemetry and policy
// ---------------------------------------------------------------------------

/** Normalized activity record ingested from any harness or from Kintsugi MCP/CLI/hooks. */
export interface HarnessActivity {
  at: string;
  projectId?: string;
  userId: string;
  harness: MemberHarnessId;
  source: "kintsugi-mcp" | "kintsugi-cli" | "plugin-hook" | "otel" | "vendor-metrics-api" | "git";
  kind:
    | "session"
    | "tool-use"
    | "write-blocked"
    | "kb-query"
    | "task-update"
    | "artifact-register"
    | "commit"
    | "pull-request";
  workItemId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Declared or measured AI share for commits/PRs/artifacts, 0–1. */
  aiShare?: number;
  /** Plugin versions active in the session, e.g. { kintsugi: "0.1.0", "proj-main-stack": "0.3.0" }. */
  plugins?: Record<string, string>;
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
  /** Plugins that must be enabled for members of the project (always includes "kintsugi"). */
  requiredPlugins?: string[];
}
