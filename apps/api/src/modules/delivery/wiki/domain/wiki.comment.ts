// Comments on wiki pages (ADR-0099 decision 1): what a comment keeps, and how the editor of the portal sees it.

/** The longest comment, the most open comments a page holds, and how long the same comment sent again is the first one. */
export const COMMENT_BODY_MAX = 8000;
export const COMMENTS_OPEN_MAX = 200;
export const COMMENT_DUPLICATE_WINDOW_SECONDS = 5;
/** The most comments one answer lists. */
export const COMMENTS_PAGE_MAX = 100;

/** What an inline comment keeps of its place: the section, the quote with its surroundings, and the commit they were seen at. */
export interface WikiCommentAnchor {
  node: string;
  exact: string;
  prefix: string;
  suffix: string;
  commit: string;
}

export interface WikiComment {
  id: string;
  projectId: string;
  pageKey: string;
  pathAtWrite: string;
  parentId: string | null;
  authorId: string;
  body: string;
  anchor: WikiCommentAnchor | null;
  status: "open" | "resolved";
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** A comment with its author, as listed. */
export interface WikiCommentRow extends WikiComment {
  author: { id: string; username: string; displayName: string };
}

/** What a comment is written with; the rest is the store's. */
export interface NewWikiComment {
  projectId: string;
  pageKey: string;
  pathAtWrite: string;
  parentId: string | null;
  authorId: string;
  body: string;
  anchor: WikiCommentAnchor | null;
}

/** Whether a stored passage is still where it was written (P3-003), moved under another heading, or gone. */
export type CommentPlacement = "anchored" | "moved" | "orphaned";

/** A comment as the portal's panel reads it. */
export interface WikiCommentView {
  id: string;
  parentId: string | null;
  author: { id: string; username: string; displayName: string };
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolved: boolean;
  deleted: boolean;
  /** The heading or card the passage is under (the page path before its first heading); null for a comment on the whole page. */
  node: string | null;
  status: CommentPlacement;
  /** The line of the page's source the passage is at now, when it can be placed. */
  line: number | null;
  /** The passage the comment was written on, always given for an inline comment. */
  quote: string | null;
}

/** The comments of a page, in time order. */
export interface WikiCommentList {
  page: { key: string; path: string };
  comments: WikiCommentView[];
  /** The `after` of the next page; null when this is the last. */
  next: string | null;
}
