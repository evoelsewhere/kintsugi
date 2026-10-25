import type { JobRunEvent, JobRunStatus, JobRunView } from "@/lib/api/job-runs";
import { stageLabel } from "@/lib/stages";
import { categoryOf, humanize, isProblem, toolOf } from "./run-events";

export const RUN_FILTERS: { id: string; label: string; statuses: JobRunStatus[] }[] = [
  { id: "", label: "All", statuses: [] },
  { id: "queued,running", label: "Active", statuses: ["queued", "running"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
  { id: "succeeded", label: "Succeeded", statuses: ["succeeded"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

export const runLabel = (run: Pick<JobRunView, "name" | "kind">): string =>
  run.kind === "stage" ? stageLabel(run.name) : humanize(run.name);

export function filterJobRuns(runs: readonly JobRunView[], filter: string, search: string): JobRunView[] {
  const statuses = RUN_FILTERS.find((entry) => entry.id === filter)?.statuses ?? [];
  const query = search.trim().toLowerCase();
  return runs.filter((run) => {
    if (statuses.length > 0 && !statuses.includes(run.status)) return false;
    return (
      query === "" ||
      [
        run.id,
        run.name,
        runLabel(run),
        run.kind,
        run.status,
        run.projectId,
        run.applicationId,
        run.actor,
        run.agent,
        run.failureReason,
        run.sourceCommit,
        run.scope?.set,
        ...(run.scope?.items ?? []),
      ].some((value) => value?.toLowerCase().includes(query) === true)
    );
  });
}

export type ConsoleFilter = "activity" | "all" | "problems" | "status" | "tool" | "model" | "log";
export const CONSOLE_FILTERS: { id: ConsoleFilter; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "all", label: "All events" },
  { id: "problems", label: "Problems" },
  { id: "status", label: "Steps & status" },
  { id: "tool", label: "Tool calls" },
  { id: "log", label: "Messages" },
  { id: "model", label: "Model progress" },
];

export function filterRunEvents(
  events: readonly JobRunEvent[],
  options: { filter: ConsoleFilter; query: string; tool: string; stepIds?: ReadonlySet<string>; attempt?: number },
  label: (id: string | undefined) => string,
): JobRunEvent[] {
  const query = options.query.trim().toLowerCase();
  return events.filter((event) => {
    if (options.attempt !== undefined && event.attempt !== undefined && event.attempt !== options.attempt) return false;
    if (options.stepIds !== undefined && !options.stepIds.has(event.stepRunId ?? "")) return false;
    if (
      options.filter === "activity"
        ? categoryOf(event) === "model"
        : options.filter === "problems"
          ? !isProblem(event)
          : options.filter !== "all" && categoryOf(event) !== options.filter
    )
      return false;
    if (options.tool !== "" && toolOf(event) !== options.tool) return false;
    return query === "" || event.message.toLowerCase().includes(query) || label(event.stepRunId).toLowerCase().includes(query);
  });
}

/** Child jobs have their own attempt counter. The parent's attempt is identified by its recorded time window. */
export function stepsForAttempt(run: JobRunView & { steps: JobRunView[] }, attempt: number): JobRunView[] {
  const record = run.attempts?.find((entry) => entry.n === attempt);
  const start = record?.startedAt ?? (attempt === run.attempt ? run.startedAt : undefined);
  const end = record?.finishedAt ?? (attempt === run.attempt ? run.finishedAt : undefined);
  if (start === undefined) return attempt === 1 && run.attempt === 1 ? run.steps : [];
  return run.steps.filter(
    (step) => Date.parse(step.createdAt) >= Date.parse(start) && (end === undefined || Date.parse(step.createdAt) <= Date.parse(end)),
  );
}

/** Resolve names for nested jobs before their navigator branches have been opened. */
export function eventStepLabels(events: readonly JobRunEvent[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const event of events) {
    if (event.stepRunId === undefined || labels.has(event.stepRunId)) continue;
    const match = /^(?:agent|script|workflow|stage)\s+(\S+)\s+(?:started|succeeded|failed|cancelled)/.exec(event.message);
    if (match?.[1] !== undefined) labels.set(event.stepRunId, humanize(match[1]));
  }
  return labels;
}
