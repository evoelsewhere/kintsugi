import { apiGet, apiSend } from "../api";

export interface ProjectAccessGrant {
  projectId: string;
  userId: string;
  grantedAt: string;
  grantedBy?: string;
}

export const projectAccessApi = {
  list: (projectId: string) => apiGet<{ items: ProjectAccessGrant[] }>(`/api/admin/project-access/${encodeURIComponent(projectId)}`),
  grant: (projectId: string, userId: string) =>
    apiSend<void>(`/api/admin/project-access/${encodeURIComponent(projectId)}/${encodeURIComponent(userId)}`, "PUT"),
  revoke: (projectId: string, userId: string) =>
    apiSend<void>(`/api/admin/project-access/${encodeURIComponent(projectId)}/${encodeURIComponent(userId)}`, "DELETE"),
};
