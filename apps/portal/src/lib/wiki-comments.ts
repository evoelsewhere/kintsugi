// The comments of a wiki page: the shapes the API gives and takes (threads/design-wiki-comments), how they are grouped for
// the panel, and what a selection of the rendered page comes to. A comment is a row of the database, never part of the page
// or of the Brain; its anchor is a passage of the page's plain text (`exact`), which the API finds again at the current commit.

// ---- The API's shapes --------------------------------------------------------------------------------------------

export type AnchoringStatus = "anchored" | "moved" | "orphaned";

/** One comment as `GET wiki/comments?path=` gives it. */
export interface CommentView {
  id: string;
  /** The comment this one answers; one level only. */
  parentId: string | null;
  author: { id: string; username: string; displayName: string };
  /** Markdown, shown through the reader's renderer. Empty for a deleted comment that has answers. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolved: boolean;
  deleted: boolean;
  /** The heading or card the passage is under; null for a comment on the whole page. */
  node: string | null;
  /** Whether the passage is still where it was, moved under another heading, or gone. A comment on the whole page is `anchored`. */
  status: AnchoringStatus;
  line: number | null;
  /** The passage the comment was written on (`exact`), always given for an inline comment. */
  quote: string | null;
}

export interface CommentList {
  page: { key: string; path: string };
  comments: CommentView[];
}

/** `POST wiki/comments`: the anchor is the selected passage and the heading it is under; the server fills in the commit. */
export interface CommentDraft {
  path: string;
  body: string;
  anchor?: { node: string; exact: string; prefix?: string; suffix?: string };
  parentId?: string;
}

// ---- The panel ---------------------------------------------------------------------------------------------------

/** The longest comment (the API refuses more) and the longest passage a comment can be anchored on. */
export const COMMENT_BODY_MAX = 8000;
export const QUOTE_MAX = 500;

/** Why a comment cannot be sent, in a person's words; undefined when it can. */
export function commentProblem(body: string): string | undefined {
  const text = body.trim();
  if (text === "") return "Write something to comment.";
  if (text.length > COMMENT_BODY_MAX) return `Keep the comment to ${COMMENT_BODY_MAX.toLocaleString("en")} characters or fewer.`;
  return undefined;
}

/** A comment with its answers. */
export interface Thread {
  comment: CommentView;
  replies: CommentView[];
}

export interface Threads {
  /** The comments on the page as a whole and those on a passage that is still there, in time order. */
  threads: Thread[];
  /** The comments whose passage is gone, with their quote: they are never lost. */
  orphaned: Thread[];
  /** The threads that are not resolved: what the Comments tab counts. */
  open: number;
}

const byTime = (a: CommentView, b: CommentView): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * The comments grouped for the panel: each comment with its answers underneath in time order; a comment whose passage is
 * gone is listed apart under Orphaned; a deleted comment is shown only while it still has answers to hold on to. An answer
 * whose parent is not in the list (it was removed) stands as a comment of its own.
 */
export function threadsOf(comments: readonly CommentView[]): Threads {
  const sorted = [...comments].sort(byTime);
  const ids = new Set(sorted.map((comment) => comment.id));
  const answers = new Map<string, CommentView[]>();
  const roots: CommentView[] = [];
  for (const comment of sorted) {
    if (comment.parentId !== null && ids.has(comment.parentId)) answers.set(comment.parentId, [...(answers.get(comment.parentId) ?? []), comment]);
    else roots.push(comment);
  }
  const all: Thread[] = roots
    .map((comment) => ({ comment, replies: (answers.get(comment.id) ?? []).filter((reply) => !reply.deleted) }))
    .filter((thread) => !thread.comment.deleted || thread.replies.length > 0);
  const orphaned = all.filter((thread) => thread.comment.status === "orphaned");
  const threads = all.filter((thread) => thread.comment.status !== "orphaned");
  return { threads, orphaned, open: all.filter((thread) => !thread.comment.resolved && !thread.comment.deleted).length };
}

// ---- A selection of the rendered page ----------------------------------------------------------------------------

/** The text of a selection as the anchor takes it: every run of white space is one space, the ends are trimmed. */
export const plainSelection = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What a selection may be anchored on: one block of the page, some text, at most `QUOTE_MAX` characters. */
export type SelectionCheck = { ok: true; exact: string } | { ok: false; reason: string };

export function checkSelection(text: string, blocks: number): SelectionCheck {
  const exact = plainSelection(text);
  if (exact === "") return { ok: false, reason: "Select some text to comment on it." };
  if (blocks !== 1) return { ok: false, reason: "Select text inside one paragraph, list item or table cell: a comment is about one passage." };
  if (exact.length > QUOTE_MAX) return { ok: false, reason: `Select at most ${QUOTE_MAX} characters: this is ${exact.length}.` };
  return { ok: true, exact };
}

/** A passage found in the text of a block: the offsets in the block's own text (white space as it is). */
export interface Found {
  start: number;
  end: number;
}

/**
 * Where `exact` (white space collapsed) is in a block's text (white space as it is): the first place its words come in
 * order with any run of white space between them. Null when the block does not hold it.
 */
export function findQuote(blockText: string, exact: string): Found | null {
  const wanted = plainSelection(exact);
  if (wanted === "") return null;
  // A map from each character of the collapsed text to its offset in the original.
  let collapsed = "";
  const offsets: number[] = [];
  let space = false;
  for (let index = 0; index < blockText.length; index += 1) {
    const char = blockText[index] as string;
    if (/\s/.test(char)) {
      space = collapsed !== "";
      continue;
    }
    if (space) {
      collapsed += " ";
      offsets.push(index);
      space = false;
    }
    collapsed += char;
    offsets.push(index);
  }
  const at = collapsed.indexOf(wanted);
  if (at < 0) return null;
  return { start: offsets[at] as number, end: (offsets[at + wanted.length - 1] as number) + 1 };
}

// ---- What a person may do with a comment --------------------------------------------------------------------------

/** The permission that writes, resolves and edits comments; deleting another person's comment needs `wiki.manage`. */
export const WIKI_COMMENT = "wiki.comment";
const WIKI_MANAGE = "wiki.manage";

/** `PATCH wiki/comments/:id`: resolve or reopen, and/or edit the text (author only); at least one. */
export interface CommentChange {
  resolved?: boolean;
  body?: string;
}

export interface CommentActions {
  /** Resolve or reopen: any commenter, on a comment that is not an answer. */
  resolve: boolean;
  /** Edit the text: its author only. */
  edit: boolean;
  /** Delete: its author while nobody has answered, or a person with `wiki.manage`. */
  remove: boolean;
  /** The delete is a moderator's (somebody else's comment, or one with answers): the dialog says so. */
  moderation: boolean;
}

/**
 * What the buttons under a comment offer. The API decides in the end (403, 409 `has-replies`); the panel only hides what
 * would be refused, so a person is not shown a button that fails.
 */
export function commentActions(comment: CommentView, answers: number, person: { id: string; permissions: readonly string[] } | null): CommentActions {
  const none: CommentActions = { resolve: false, edit: false, remove: false, moderation: false };
  if (person === null || comment.deleted) return none;
  const commenter = person.permissions.includes(WIKI_COMMENT);
  const manager = person.permissions.includes(WIKI_MANAGE);
  const own = comment.author.id === person.id;
  const author = own && commenter;
  // An author deletes only while nobody has answered; a moderator deletes any, an answered one stays as a marker.
  const remove = (author && answers === 0) || manager;
  return { resolve: commenter && comment.parentId === null, edit: author, remove, moderation: remove && !(author && answers === 0) };
}
