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

/** What the access route answers until the rules are in place. */
export interface WikiAccessPlaceholder {
  canWrite: false;
  canPublish: false;
  reason: "not-implemented";
}
