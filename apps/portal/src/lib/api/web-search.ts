import type { WebSearchSettings } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";
const path = (projectId: string): string => `/api/admin/projects/${encodeURIComponent(projectId)}/web-search`;
export const webSearchApi = {
  get: (projectId: string) => apiGet<WebSearchSettings>(path(projectId)),
  configure: (projectId: string, settings: WebSearchSettings) => apiSend<void>(path(projectId), "PUT", settings),
};
