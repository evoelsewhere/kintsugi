import type { ProjectMemoryView } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";

const path = (projectId: string): string => `/api/admin/projects/${encodeURIComponent(projectId)}/memory`;
export const projectMemoryApi = {
  get: (projectId: string, offset = 0) => apiGet<ProjectMemoryView>(`${path(projectId)}?limit=20&offset=${offset}`),
  configure: (projectId: string, enabled: boolean) => apiSend<void>(path(projectId), "PUT", { enabled }),
  reset: (projectId: string) => apiSend<void>(path(projectId), "DELETE"),
  forget: (projectId: string, id: string) => apiSend<{ recoveryId: string }>(`${path(projectId)}/${encodeURIComponent(id)}/forget`, "POST"),
  restore: (projectId: string, recoveryId: string) => apiSend<{ id: string }>(`${path(projectId)}/recoveries/${encodeURIComponent(recoveryId)}/restore`, "POST"),
  review: (projectId: string, id: string, state: "approved" | "rejected") => apiSend<void>(`${path(projectId)}/${encodeURIComponent(id)}`, "PATCH", { state }),
};
