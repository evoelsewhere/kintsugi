// Typed access to the wiki's writing routes (`/api/projects/:id/wiki/...`): what a person may do with a page, their draft of
// it, and publishing. The shapes are those of threads/design-wiki-draft-publish; the API enforces every rule again.

import type { AccessView, DraftApi, DraftSaveBody, DraftView, PublishRequest, PublishResult } from "../wiki-edit";
import { apiGet, ApiError, apiSend } from "../api";

const base = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/wiki`;

export const wikiEditApi = {
  /** What the person may do with a path: whether to offer Edit, and why not when it is refused. */
  access: (projectId: string, path: string): Promise<AccessView> => apiGet(`${base(projectId)}/access?${new URLSearchParams({ path }).toString()}`),

  /** The person's own draft of a page, or null when they have none (the 404 of the API). */
  draft: async (projectId: string, path: string): Promise<DraftView | null> => {
    try {
      return await apiGet<DraftView>(`${base(projectId)}/draft?${new URLSearchParams({ path }).toString()}`);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) return null;
      throw failure;
    }
  },

  saveDraft: (projectId: string, body: DraftSaveBody): Promise<DraftView> => apiSend(`${base(projectId)}/draft`, "PUT", body),

  discardDraft: (projectId: string, path: string): Promise<void> => apiSend(`${base(projectId)}/draft?${new URLSearchParams({ path }).toString()}`, "DELETE"),

  publish: (projectId: string, request: PublishRequest): Promise<PublishResult> => apiSend(`${base(projectId)}/publish`, "POST", request),
};

/** The part of the client the draft saver needs, for one project. */
export const draftApiOf = (projectId: string): DraftApi => ({
  save: (body) => wikiEditApi.saveDraft(projectId, body),
  load: (path) => wikiEditApi.draft(projectId, path),
});
