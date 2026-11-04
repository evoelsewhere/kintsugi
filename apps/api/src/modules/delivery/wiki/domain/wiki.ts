// What editing a wiki keeps in Postgres (ADR-0098 decision 2, ADR-0099 decision 5): a person's draft of a page, the
// files attached to it, and the restrictions on who may edit or publish under a path.

/** One person's unpublished text of one page. */
export interface WikiDraft {
  id: string;
  projectId: string;
  userId: string;
  /** The path of the page in the document repo. */
  path: string;
  pageId: string | null;
  text: string;
  /** The commit the text was read from, and the hash of the file there; null for a page that does not exist yet. */
  baseCommit: string | null;
  baseHash: string | null;
  revision: number;
  /** The document write that published the draft, until that write is merged or committed. */
  writeId: string | null;
  touchedAt: string;
}

/** Another person working on the same page: who and when, never their text. */
export interface WikiPresence {
  userId: string;
  /** Their display name, or their sign-in name when they have none. */
  name: string;
  touchedAt: string;
}

/** A draft as the editor sees it: the caller's own, with who else has touched the page lately. */
export interface WikiDraftView {
  path: string;
  pageId: string | null;
  text: string;
  revision: number;
  baseCommit: string | null;
  baseHash: string | null;
  touchedAt: string;
  writeId: string | null;
  others: WikiPresence[];
}

/** One line of the list of a person's drafts. */
export interface WikiDraftSummary {
  path: string;
  touchedAt: string;
  revision: number;
  writeId: string | null;
}

/** The head of the default branch as far as one page is concerned: the commit, and the hash of the page there (null: it does not exist). */
export interface WikiHead {
  commit: string;
  hash: string | null;
}

/** What publishing a draft came to. Only `published` has written anything. */
export type WikiPublishResult =
  | { outcome: "unchanged" }
  | { outcome: "merge-preview"; merged: string; head: WikiHead; base: { commit: string | null; hash: string | null } }
  | { outcome: "published"; write: { id: string; status: string; mode: "pull-request" | "direct"; branch?: string; prUrl?: string } };

/** What a draft is created with; the rest of it is the store's (id, revision 1, time). */
export interface NewWikiDraft {
  projectId: string;
  userId: string;
  path: string;
  pageId: string | null;
  text: string;
  baseCommit: string | null;
  baseHash: string | null;
}

/** A file attached to a draft as the editor sees it: the name the server gave it and the Markdown that shows it. */
export interface WikiAttachmentView extends WikiAttachment {
  markdown: string;
}

/** A file attached to a draft. */
export interface WikiAttachment {
  name: string;
  contentType: string;
  size: number;
}

export type WikiRestrictionKind = "edit" | "publish";
export type WikiSubjectKind = "user" | "role";

/** Who may do `kind` under `pathPrefix` (a file, or a folder ending in "/"); several rows of a prefix are alternatives. */
export interface WikiRestriction {
  id: string;
  projectId: string;
  pathPrefix: string;
  subjectKind: WikiSubjectKind;
  subjectId: string;
  kind: WikiRestrictionKind;
  createdBy: string | null;
  createdAt: string;
}

/** Why a person may not write a page. */
export interface WikiRefusal {
  code: "not-editable" | "permission" | "restriction";
  message: string;
  /** The restriction that refuses, for code `restriction`. */
  pathPrefix?: string;
}

/** The open write of a page, which a person sees as "waiting for review". */
export interface WikiPendingWrite {
  writeId: string;
  status: string;
  prUrl: string | null;
  author: string | null;
}

/** What the caller may do to one page (design-wiki-draft-publish, section 1). The API checks again at every write route. */
export interface WikiAccess {
  path: string;
  /** The path is a page (or attachment) the wiki can edit at all. */
  editable: boolean;
  /** Needs `wiki.write`, an editable path and every `edit` restriction that covers it. */
  canWrite: boolean;
  /** Publishing goes through a pull request, so it is `canWrite`. */
  canPublish: boolean;
  /** Publish straight to the default branch: `canWrite`, `wiki.publish`, a path of `directPublishPaths` and the `publish` restrictions. */
  direct: boolean;
  refusal: WikiRefusal | null;
  pending: WikiPendingWrite | null;
}

/** A person or role a restriction lets in, with the name to show. */
export interface WikiSubject {
  kind: WikiSubjectKind;
  id: string;
  name: string;
}

/** The restriction of one prefix and kind as the portal shows it: everyone it lets in. */
export interface WikiRestrictionView {
  pathPrefix: string;
  kind: WikiRestrictionKind;
  subjects: WikiSubject[];
}
