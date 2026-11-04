// Typed access to the comments of a wiki page (`/api/projects/:id/wiki/comments`). Comments are rows of the database: they
// are never read from or written to the document repository, and the Brain does not hold them.

import { apiGet, apiSend } from "../api";
import type { CommentDraft, CommentList, CommentView } from "../wiki-comments";

const base = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/wiki/comments`;

export const wikiCommentsApi = {
  /** The comments of a page, in time order, each inline one placed again at the commit the Brain indexed. */
  list: (projectId: string, path: string): Promise<CommentList> => apiGet(`${base(projectId)}?${new URLSearchParams({ path }).toString()}`),

  /** Writes a comment or an answer; the API takes the commit itself and refuses a passage the page does not hold. */
  post: (projectId: string, draft: CommentDraft): Promise<CommentView> => apiSend(base(projectId), "POST", draft),
};
