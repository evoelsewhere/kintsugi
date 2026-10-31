import type { BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";

const path = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/brain`;
const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
};

/** The Brain of a project (ADR-0091): its index state, and the reads an agent reasons with. */
export const brainApi = {
  status: (projectId: string) => apiGet<BrainStatusView>(path(projectId)),
  configure: (projectId: string, input: { enabled: boolean; branch?: string }) => apiSend<BrainStatusView>(path(projectId), "PUT", input),
  rebuild: (projectId: string) => apiSend<BrainStatusView>(`${path(projectId)}/rebuild`, "POST"),
  tree: (projectId: string, node: string | undefined, offset = 0, limit = 100) => apiGet<BrainTreeView>(`${path(projectId)}/tree${query({ node, offset, limit })}`),
  node: (projectId: string, node: string, fromLine?: number) => apiGet<BrainReadView>(`${path(projectId)}/node${query({ node, fromLine })}`),
  lookup: (projectId: string, q: string) => apiGet<BrainLookupView>(`${path(projectId)}/lookup${query({ q })}`),
  grep: (projectId: string, text: string, under?: string) => apiGet<BrainGrepView>(`${path(projectId)}/grep${query({ text, under })}`),
};
