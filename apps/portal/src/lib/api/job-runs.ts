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
  scriptHash?: string;
  agent?: string;
  actor?: string;
  outputSummary?: { files?: number; bytes?: number } & Record<string, unknown>;
  documentWrite?: { id: string; status: string; branch?: string; prUrl?: string; error?: string };
  restrictedRecords: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface JobRunDetail extends JobRunView {
  steps: JobRunView[];
  artifacts: Array<{ path: string; sha256: string; size: number; provenance: { origin: string; runtimeAgent?: string } }>;
}

const project = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`;

export const jobRunsApi = {
  runStage: (projectId: string, applicationId: string, stage: string) =>
    apiSend<JobRunView>(`${project(projectId)}/applications/${encodeURIComponent(applicationId)}/stages/${stage}/run`, "POST"),
  list: (projectId: string, applicationId: string, limit = 5) =>
    apiGet<Page<JobRunView>>(`${project(projectId)}/job-runs?applicationId=${encodeURIComponent(applicationId)}&limit=${limit}`),
  get: (projectId: string, id: string) => apiGet<JobRunDetail>(`${project(projectId)}/job-runs/${encodeURIComponent(id)}`),
};
