// Typed access to the wiki's writing routes (`/api/projects/:id/wiki/...`): what a person may do with a page, their draft of
// it, and publishing. The shapes are those of threads/design-wiki-draft-publish; the API enforces every rule again.

import type { AccessView, AttachmentUpload, AttachmentView, DeleteBody, DeleteResult, DraftApi, DraftSaveBody, DraftView, MoveBody, MovePreview, NewPageBody, PublishRequest, PublishResult, TemplateOption } from "../wiki-edit";
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

  /** The templates a new page of a folder can start from (the space's own and the system's). */
  templates: (projectId: string, folder: string): Promise<TemplateOption[]> => apiGet(`${base(projectId)}/templates?${new URLSearchParams({ folder }).toString()}`),

  /** Makes a new page: its id and path are the API's, the answer is its draft (nothing is written to the repository). */
  createPage: (projectId: string, body: NewPageBody): Promise<DraftView> => apiSend(`${base(projectId)}/pages`, "POST", body),

  /** What a move would change, without changing anything. */
  movePreview: (projectId: string, body: MoveBody): Promise<MovePreview> => apiSend(`${base(projectId)}/move/preview`, "POST", body),

  /** Moves or renames a page and rewrites the links to it: one write, a pull request or a commit. */
  move: (projectId: string, body: MoveBody): Promise<PublishResult> => apiSend(`${base(projectId)}/move`, "POST", body),

  /** Deletes a page in one write (a pull request or a commit); links into it become broken links. */
  deletePage: (projectId: string, body: DeleteBody): Promise<DeleteResult> => apiSend(`${base(projectId)}/delete`, "POST", body),

  /** The attachments of the person's draft of a page. */
  attachments: (projectId: string, path: string): Promise<AttachmentView[]> => apiGet(`${base(projectId)}/draft/attachments?${new URLSearchParams({ path }).toString()}`),

  /** Keeps a file beside the draft; the answer holds the name the server gave it and the Markdown to insert. */
  attach: (projectId: string, body: AttachmentUpload): Promise<AttachmentView> => apiSend(`${base(projectId)}/draft/attachments`, "POST", body),

  detach: (projectId: string, path: string, name: string): Promise<void> => apiSend(`${base(projectId)}/draft/attachments?${new URLSearchParams({ path, name }).toString()}`, "DELETE"),

  publish: (projectId: string, request: PublishRequest): Promise<PublishResult> => apiSend(`${base(projectId)}/publish`, "POST", request),
};

/** The part of the client the draft saver needs, for one project. */
export const draftApiOf = (projectId: string): DraftApi => ({
  save: (body) => wikiEditApi.saveDraft(projectId, body),
  load: (path) => wikiEditApi.draft(projectId, path),
});
