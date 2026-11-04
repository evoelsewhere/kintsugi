import type { BrainChangesView, BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";

const path = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/brain`;
const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
};

const nonEmpty = (value: string | undefined): string | undefined => (value === undefined || value === "" ? undefined : value);

/** The Brain of a project (ADR-0091): its index state, and the reads an agent reasons with. */
export const brainApi = {
  status: (projectId: string) => apiGet<BrainStatusView>(path(projectId)),
  configure: (projectId: string, input: { enabled: boolean; branch?: string }) => apiSend<BrainStatusView>(path(projectId), "PUT", input),
  /** Turns the project's wiki on (its Brain then follows the default branch) or off; needs `wiki.manage`. A refusal (409) says why. */
  setWiki: (projectId: string, enabled: boolean) => apiSend<BrainStatusView>(`/api/projects/${encodeURIComponent(projectId)}/wiki`, "PUT", { enabled }),
  rebuild: (projectId: string) => apiSend<BrainStatusView>(`${path(projectId)}/rebuild`, "POST"),
  tree: (projectId: string, node: string | undefined, offset = 0, limit = 100) => apiGet<BrainTreeView>(`${path(projectId)}/tree${query({ node, offset, limit })}`),
  node: (projectId: string, node: string, fromLine?: number) => apiGet<BrainReadView>(`${path(projectId)}/node${query({ node, fromLine })}`),
  lookup: (projectId: string, q: string) => apiGet<BrainLookupView>(`${path(projectId)}/lookup${query({ q })}`),
  /** `space` and `label` narrow the search to the pages of that space or with that label (the wiki's search box). */
  grep: (projectId: string, text: string, under?: string, filter: { space?: string; label?: string } = {}) =>
    apiGet<BrainGrepView>(`${path(projectId)}/grep${query({ text, under, space: nonEmpty(filter.space), label: nonEmpty(filter.label) })}`),
  changes: (projectId: string, since: string, under?: string) => apiGet<BrainChangesView>(`${path(projectId)}/changes${query({ since, under })}`),
};
