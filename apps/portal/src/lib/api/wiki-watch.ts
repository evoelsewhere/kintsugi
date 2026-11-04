// What a person watches in a project's wiki (`/api/projects/:id/wiki/watches`): a page, a folder or a space. Only the person's own.

import { apiGet, apiSend } from "../api";
import type { WatchScope, WatchState } from "../notifications";

const base = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/wiki/watches`;

export const wikiWatchApi = {
  /** Whether a page is watched, and through what when it is not watched itself. */
  state: (projectId: string, path: string): Promise<WatchState> => apiGet(`${base(projectId)}?${new URLSearchParams({ path }).toString()}`),

  /** Everything the person watches in the project. */
  list: (projectId: string): Promise<Array<{ scopeKind: WatchScope; target: string; createdAt: string; path?: string; title?: string }>> => apiGet(base(projectId)),

  watch: (projectId: string, scopeKind: WatchScope, target: string): Promise<void> => apiSend(base(projectId), "PUT", { scopeKind, target }),

  unwatch: (projectId: string, scopeKind: WatchScope, target: string): Promise<void> => apiSend(`${base(projectId)}?${new URLSearchParams({ scopeKind, target }).toString()}`, "DELETE"),
};
