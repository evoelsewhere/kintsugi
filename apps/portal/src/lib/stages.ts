// Stage vocabulary of the portal: the pipeline stages from GET /api/stages grouped by who runs
// them (runtime jobs, members in their harnesses, portal screens), the latest run of a stage
// and the document-repo paths a stage reads or writes, resolved for one application.

import type { AgentSummary } from "@/lib/api/agents";
import type { JobRunView, StageView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";

export type StageAudience = StageView["audience"];

export const AUDIENCE_ORDER: readonly StageAudience[] = ["runtime", "member", "portal"];

export const AUDIENCE_LABEL: Record<StageAudience, string> = {
  runtime: "Runtime stages",
  member: "Member stages",
  portal: "Portal stages",
};

export const AUDIENCE_SHORT: Record<StageAudience, string> = {
  runtime: "Runtime",
  member: "Members",
  portal: "Portal",
};

/** The stages in pipeline order, grouped by audience (runtime, member, portal); the API order is kept within a group. */
/** The runtime stages a person runs (ADR-0033): map, extract-rules and harden are steps of understand now. */
export const RUNTIME_STAGES: readonly string[] = ["assess", "understand"];

/** The stages shown in the pipeline: every member and portal stage, and only the runtime stages a person runs. */
export function pipelineStages(stages: readonly StageView[]): StageView[] {
  return stages.filter((stage) => stage.audience !== "runtime" || RUNTIME_STAGES.includes(stage.id));
}

export function stagesByAudience(stages: readonly StageView[]): Array<{ audience: StageAudience; stages: StageView[] }> {
  return AUDIENCE_ORDER.map((audience) => ({ audience, stages: stages.filter((stage) => stage.audience === audience) })).filter((group) => group.stages.length > 0);
}

/** The newest top-level run of a stage among `runs` (newest first). */
export function latestRun(runs: readonly JobRunView[], stageId: string): JobRunView | undefined {
  return runs.find((run) => run.kind === "stage" && run.name === stageId);
}

/** The top-level runs of a stage (the run list has no stage filter, so it is filtered here). */
export function runsOfStage(runs: readonly JobRunView[], stageId: string): JobRunView[] {
  return runs.filter((run) => run.kind === "stage" && run.name === stageId);
}

/** Why no runtime stage can start for the application (no legacy or document repo); undefined when they can. */
export function runBlocker(project: ProjectDetail, application: ApplicationView): string | undefined {
  if (project.documentRepository === null) return "The project has no document repo, so job output has nowhere to go.";
  if (application.asIs.legacy.length === 0) return "Link a legacy code repo to the application to run stages.";
  return undefined;
}

/** Agents of a stage that cannot run as configured: unknown, disabled, invalid or without a model binding. */
export function agentProblems(stage: StageView, agents: AgentSummary[] | undefined): string[] {
  if (agents === undefined) return [];
  return stage.agents.flatMap((name) => {
    const agent = agents.find((entry) => entry.name === name);
    if (agent === undefined) return [`${name} is not in the agent catalog`];
    if (!agent.enabled) return [`${name} is disabled`];
    if (agent.problems.length > 0) return [`${name} is invalid`];
    if (agent.binding === undefined) return [`${name} has no model binding`];
    return [];
  });
}

/** A path pattern of a stage (`assessment/<app>/ASSESSMENT.md`) for one application. */
export function resolvePath(pattern: string, applicationId: string): string {
  return pattern.replaceAll("<app>", applicationId).replaceAll("$app", applicationId);
}

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a document-repo path matches a stage path pattern for one application: `<…>` and
 * `*` stand for one path segment, a trailing `/` for everything below a directory.
 */
export function matchesPattern(pattern: string, applicationId: string, path: string): boolean {
  const resolved = resolvePath(pattern, applicationId);
  const directory = resolved.endsWith("/");
  const source = escapeRegExp(directory ? resolved.slice(0, -1) : resolved)
    .replace(/<[^>]+>/g, "[^/]+")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}${directory ? "/.+" : ""}$`).test(path);
}

/** The file name of a path pattern, or undefined for directories and placeholders. */
export function fileName(pattern: string): string | undefined {
  if (pattern.endsWith("/")) return undefined;
  const name = pattern.slice(pattern.lastIndexOf("/") + 1);
  return name === "" || name.includes("<") || name.includes("*") ? undefined : name;
}
