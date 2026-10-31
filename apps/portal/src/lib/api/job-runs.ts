// Typed access to runtime job runs (ADR-0027, ADR-0029). Mirrors apps/api →
// modules/delivery/runtime-jobs: a stage run is queued by the API and run by the worker in a
// job workspace; its output reaches the document repo through a document write.

import { apiGet, apiSend, type Page } from "../api";

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRunView {
  id: string;
  projectId: string;
  applicationId?: string;
  parentId?: string;
  kind: "stage" | "script" | "agent" | "workflow";
  name: string;
  status: JobRunStatus;
  failureReason?: string;
  sourceRepositoryId?: string;
  sourceCommit?: string;
  /** Every repository the run reads, each at its commit: the legacy code (the first is `sourceRepositoryId`) and the target code, read-only (ADR-0055). */
  sources?: Array<{ repositoryId: string; commit?: string; role?: "legacy" | "target" }>;
  /** 1 for the first attempt; a retry of a failed or cancelled stage run is the next attempt of the same run. */
  attempt: number;
  /** The attempts that ended, oldest first (top-level runs). */
  attempts?: JobAttempt[];
  scriptHash?: string;
  agent?: string;
  actor?: string;
  outputSummary?: { files?: number; bytes?: number } & Record<string, unknown>;
  documentWrite?: { id: string; status: string; branch?: string; prUrl?: string; error?: string };
  restrictedRecords: number;
  /** Set while the worker is stopping a run a person cancelled. */
  cancelRequestedAt?: string;
  /** The catalog items of an understand run (ADR-0033). */
  scope?: { items: string[]; set?: string; regenerate?: boolean; draft?: boolean };
  /** Set when a person abandoned the run's pull request (its items are released). */
  abandonedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

/** What one finished attempt of a job did. */
export interface JobAttempt {
  n: number;
  status: "succeeded" | "failed" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
}

export interface JobRunDetail extends JobRunView {
  steps: JobRunView[];
  artifacts: Array<{ path: string; sha256: string; size: number; provenance: { origin: string; runtimeAgent?: string } }>;
}

/** One line of a run's live record: redacted by the worker, never file content. */
export interface JobRunEvent {
  id: string;
  at: string;
  kind: "status" | "step.started" | "step.finished" | "tool" | "log";
  message: string;
  stepRunId?: string;
  /** The attempt of the run the event belongs to. */
  attempt?: number;
  data: Record<string, unknown>;
}

/** A run a retry put back in the queue (ADR-0090). */
export type RetriedRunView = JobRunView & {
  /** The agents whose steps run again whatever changed: they may look things up on the web. */
  rerunsWebAgents?: string[];
};

export const isActive = (run: Pick<JobRunView, "status">): boolean => run.status === "queued" || run.status === "running";

/** A stage of the built-in pipeline (packages/agents/builtin/plugins/<plugin>/commands), and whether the portal can run it yet. */
export interface StageView {
  id: string;
  command: string;
  /** The built-in plugin that carries the command; a member runs a member command as `/<plugin>:<command>` (lib/stage-command.ts). */
  plugin?: string;
  description: string;
  /** runtime = Kintsugi jobs; member = members' harnesses; portal = a portal screen. */
  audience: "runtime" | "member" | "portal";
  agents: string[];
  /** Paths the stage reads (document repo, source). */
  reads?: string[];
  /** Document-repo paths the stage writes, using domain-owned layout patterns. */
  writes: string[];
  /** Where a person decides before the stage goes on (from the command definition). */
  gates: string[];
  runnable: boolean;
}

export interface JobRunFilter {
  status?: JobRunStatus[];
  projectId?: string;
  applicationId?: string;
  limit?: number;
  offset?: number;
}

/** Metadata of a restricted record (never its content); opening it is audited. */
export interface RestrictedRecordSummary {
  jobRunId: string;
  topLevelRunId: string;
  projectId: string;
  applicationId?: string;
  runName: string;
  stepName?: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface RestrictedRecord {
  jobRunId: string;
  path: string;
  size: number;
  content: string;
  createdAt: string;
}

/** `?a=1&b=2` from the defined entries (arrays joined with commas). */
export function queryString(entries: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries) as [string, unknown][]) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else if (typeof value === "string" || typeof value === "number") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

const project = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`;

export const jobRunsApi = {
  runStage: (projectId: string, applicationId: string, stage: string) =>
    apiSend<JobRunView>(`${project(projectId)}/applications/${encodeURIComponent(applicationId)}/stages/${stage}/run`, "POST"),
  list: (projectId: string, applicationId: string, limit = 5) =>
    apiGet<Page<JobRunView>>(`${project(projectId)}/job-runs?applicationId=${encodeURIComponent(applicationId)}&limit=${limit}`),
  /** Top-level runs across projects, newest first. */
  listAll: (filter: JobRunFilter = {}) =>
    apiGet<Page<JobRunView>>(`/api/job-runs${queryString({ status: filter.status, projectId: filter.projectId, applicationId: filter.applicationId, limit: filter.limit, offset: filter.offset })}`),
  stages: () => apiGet<StageView[]>("/api/stages"),
  /** Restricted records across projects, metadata only (restricted.read). */
  restrictedRecords: (filter: { projectId?: string; jobRunId?: string; limit?: number; offset?: number } = {}) =>
    apiGet<Page<RestrictedRecordSummary>>(`/api/governance/restricted-records${queryString(filter)}`),
  /** Decrypts the restricted records of a top-level run; every record read is audited. */
  openRestricted: (projectId: string, id: string) => apiGet<RestrictedRecord[]>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}/restricted`),
  get: (projectId: string, id: string) => apiGet<JobRunDetail>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}`),
  cancel: (projectId: string, id: string) => apiSend<JobRunView>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}/cancel`, "POST"),
  /**
   * Retries a failed stage run: the same run, the next attempt, from what its workspace kept. `fresh` begins from
   * nothing (its results are discarded, its pinned commits stay).
   */
  retry: (projectId: string, id: string, options: { fresh?: boolean } = {}) =>
    apiSend<RetriedRunView>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}/retry`, "POST", options.fresh === true ? { fresh: true } : {}),
  /** Abandons the closed pull request of an understand run: its items are released. */
  abandon: (projectId: string, id: string) => apiSend<JobRunView>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}/abandon`, "POST"),
  /**
   * Follows a run live over Server-Sent Events (the session cookie authenticates the stream).
   * Returns a function that closes the stream; it also closes itself when the run has ended.
   */
  follow(projectId: string, id: string, handlers: { onEvent(event: JobRunEvent): void; onStatus(run: JobRunView): void; onEnd(run: JobRunView): void; onConnection?: (state: "connected" | "reconnecting") => void }): () => void {
    const source = new EventSource(`${project(projectId)}/job-runs/${encodeURIComponent(id)}/events`);
    source.onopen = () => handlers.onConnection?.("connected");
    source.onerror = () => handlers.onConnection?.("reconnecting");
    source.addEventListener("job-event", (message) => handlers.onEvent(JSON.parse((message as MessageEvent<string>).data) as JobRunEvent));
    source.addEventListener("status", (message) => handlers.onStatus(JSON.parse((message as MessageEvent<string>).data) as JobRunView));
    source.addEventListener("end", (message) => {
      source.close();
      handlers.onEnd(JSON.parse((message as MessageEvent<string>).data) as JobRunView);
    });
    return () => source.close();
  },
};
