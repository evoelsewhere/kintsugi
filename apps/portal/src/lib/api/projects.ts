// Typed access to projects, applications and their repositories (Administration -> Projects).
// Mirrors apps/api -> modules/admin/projects (ADR-0028). Repositories are the ones
// registered in Settings -> Git; a project references them, grouped AS-IS / TO-BE.

import type { ApplicationRepositoryRole, Disposition, RepositoryRole } from "@kintsugi/domain";
import { apiGet, apiGetAll, apiSend } from "../api";

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
  disposition: Disposition;
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

export interface ApplicationInput {
  name: string;
  disposition: Disposition;
  pipeline?: string | null;
}

export interface LinkInput {
  repositoryId: string;
  role: ApplicationRepositoryRole;
  component?: string;
}

const PROJECTS = "/api/admin/projects";
const application = (projectId: string, id: string): string => `${PROJECTS}/${projectId}/applications/${id}`;

export const projectsApi = {
  list: () => apiGetAll<ProjectView>(PROJECTS),
  get: (id: string) => apiGet<ProjectDetail>(`${PROJECTS}/${id}`),
  create: (input: ProjectInput & { id: string }) => apiSend<ProjectView>(PROJECTS, "POST", input),
  update: (id: string, input: Partial<ProjectInput>) => apiSend<ProjectView>(`${PROJECTS}/${id}`, "PATCH", input),
  remove: (id: string) => apiSend<void>(`${PROJECTS}/${id}`, "DELETE"),
  manifest: (id: string) => apiGet<{ fileName: string; content: string }>(`${PROJECTS}/${id}/kintsugi.yaml`),
  createApplication: (projectId: string, input: ApplicationInput & { id: string }) => apiSend<ApplicationView>(`${PROJECTS}/${projectId}/applications`, "POST", input),
  updateApplication: (projectId: string, id: string, input: Partial<ApplicationInput>) => apiSend<ApplicationView>(application(projectId, id), "PATCH", input),
  removeApplication: (projectId: string, id: string) => apiSend<void>(application(projectId, id), "DELETE"),
  link: (projectId: string, applicationId: string, input: LinkInput) => apiSend<ProjectDetail>(`${application(projectId, applicationId)}/repositories`, "POST", input),
  unlink: (projectId: string, applicationId: string, repositoryId: string) =>
    apiSend<void>(`${application(projectId, applicationId)}/repositories/${repositoryId}`, "DELETE"),
};
