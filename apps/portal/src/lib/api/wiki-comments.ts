// Typed access to the comments of a wiki page (`/api/projects/:id/wiki/comments`). Comments are rows of the database: they
// are never read from or written to the document repository, and the Brain does not hold them.

import { apiGet, apiSend } from "../api";
import type { CommentChange, CommentDraft, CommentList, CommentView } from "../wiki-comments";

const base = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/wiki/comments`;

export const wikiCommentsApi = {
  /** The comments of a page, in time order, each inline one placed again at the commit the Brain indexed. */
  list: (projectId: string, path: string): Promise<CommentList> => apiGet(`${base(projectId)}?${new URLSearchParams({ path }).toString()}`),

  /** Writes a comment or an answer; the API takes the commit itself and refuses a passage the page does not hold. */
  post: (projectId: string, draft: CommentDraft): Promise<CommentView> => apiSend(base(projectId), "POST", draft),

  /** Resolves or reopens a comment, or edits its text (its author only); gives the comment as it is now. */
  update: (projectId: string, commentId: string, change: CommentChange): Promise<CommentView> => apiSend(`${base(projectId)}/${encodeURIComponent(commentId)}`, "PATCH", change),

  /** Deletes a comment: its author while nobody has answered (409 `has-replies` otherwise), or a person with `wiki.manage`. */
  remove: (projectId: string, commentId: string): Promise<void> => apiSend(`${base(projectId)}/${encodeURIComponent(commentId)}`, "DELETE"),
};
