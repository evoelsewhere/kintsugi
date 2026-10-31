// Typed access to projects, applications and their repositories (Administration -> Projects).
// Mirrors apps/api -> modules/admin/projects (ADR-0028). Repositories are the ones
// registered in Settings -> Git; a project references them, grouped AS-IS / TO-BE.

import type { ApplicationRepositoryRole, RepositoryRole } from "@kintsugi/domain";
import { apiGet, apiGetAll, apiSend, type Page } from "../api";

export interface ProjectView {
  id: string;
  name: string;
  description?: string;
  documentRepositoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepositoryView {
  repositoryId: string;
  role: RepositoryRole;
  component?: string;
  serverId: string;
  url: string;
  /** Path on its server, as written in kintsugi.yaml. */
  path: string;
  defaultBranch?: string;
  syncStatus: string;
}

export interface ApplicationView {
  id: string;
  projectId: string;
  name: string;
  pipeline?: string;
  asIs: { legacy: ProjectRepositoryView[]; legacyData: ProjectRepositoryView[] };
  toBe: { document: ProjectRepositoryView | null; targets: ProjectRepositoryView[] };
}

export interface ProjectDetail extends ProjectView {
  documentRepository: ProjectRepositoryView | null;
  applications: ApplicationView[];
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  documentRepositoryId: string;
}

/** One link of a registered repository to a project. */
export interface RepositoryLinkView {
  repositoryId: string;
  projectId: string;
  role: RepositoryRole;
  /** null for the document repo, which belongs to the project. */
  applicationId: string | null;
  component?: string;
}

export interface ApplicationInput {
  name: string;
  pipeline?: string | null;
}

export interface LinkInput {
  repositoryId: string;
  role: ApplicationRepositoryRole;
  component?: string;
}

/** A write to the project's document repo, performed by the worker (ADR-0019). */
export interface DocumentWriteView {
  id: string;
  projectId: string;
  kind: string;
  status: "queued" | "committed" | "pr-opened" | "merged" | "closed" | "unchanged" | "failed";
  message: string;
  commit?: string;
  branch?: string;
  branchCommit?: string;
  prUrl?: string;
  error?: string;
  actor?: string;
  jobId?: string;
  agent?: string;
  createdAt: string;
  updatedAt: string;
}

const PROJECTS = "/api/admin/projects";
const application = (projectId: string, id: string): string => `${PROJECTS}/${projectId}/applications/${id}`;

export const projectsApi = {
  list: () => apiGetAll<ProjectView>(PROJECTS),
  /** Where every registered repository is linked, to mark the repositories in use. */
  repositoryLinks: () => apiGet<RepositoryLinkView[]>(`${PROJECTS}/repository-links`),
  get: (id: string) => apiGet<ProjectDetail>(`${PROJECTS}/${id}`),
  create: (input: ProjectInput & { id: string }) => apiSend<ProjectView>(PROJECTS, "POST", input),
  update: (id: string, input: Partial<ProjectInput>) => apiSend<ProjectView>(`${PROJECTS}/${id}`, "PATCH", input),
  remove: (id: string) => apiSend<void>(`${PROJECTS}/${id}`, "DELETE"),
  manifest: (id: string) => apiGet<{ fileName: string; content: string }>(`${PROJECTS}/${id}/kintsugi.yaml`),
  publishManifest: (id: string, options: { scaffold?: boolean } = {}) => apiSend<DocumentWriteView>(`${PROJECTS}/${id}/kintsugi.yaml/publish`, "POST", options),
  documentWrites: (id: string, limit = 10) => apiGet<Page<DocumentWriteView>>(`${PROJECTS}/${id}/document-writes?limit=${limit}`),
  createApplication: (projectId: string, input: ApplicationInput & { id: string }) => apiSend<ApplicationView>(`${PROJECTS}/${projectId}/applications`, "POST", input),
  updateApplication: (projectId: string, id: string, input: Partial<ApplicationInput>) => apiSend<ApplicationView>(application(projectId, id), "PATCH", input),
  removeApplication: (projectId: string, id: string) => apiSend<void>(application(projectId, id), "DELETE"),
  link: (projectId: string, applicationId: string, input: LinkInput) => apiSend<ProjectDetail>(`${application(projectId, applicationId)}/repositories`, "POST", input),
  unlink: (projectId: string, applicationId: string, repositoryId: string) =>
    apiSend<void>(`${application(projectId, applicationId)}/repositories/${repositoryId}`, "DELETE"),
};
