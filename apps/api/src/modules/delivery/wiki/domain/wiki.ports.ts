// Ports of the wiki's working state (ADR-0098, ADR-0099); the Pg adapters implement them.

import type { NewWikiComment, WikiCommentRow } from "./wiki.comment.js";
import type { NewWikiDraft, WikiAttachment, WikiWatch, WikiWatchScope, WikiDraft, WikiPresence, WikiRestriction, WikiRestrictionKind, WikiSubjectKind } from "./wiki.js";

export abstract class WikiDrafts {
  /** The draft of `userId` for the page, or undefined. */
  abstract find(projectId: string, userId: string, path: string): Promise<WikiDraft | undefined>;
  /** Creates the draft at revision 1; a draft of this person for the page already there is an error. */
  abstract create(draft: NewWikiDraft): Promise<WikiDraft>;
  /**
   * Replaces the text if the stored revision is `baseRevision`, raising the revision by one and touching it; undefined
   * when the draft is gone or its revision has moved on. A change of the text means the draft is no longer what the
   * write it was published with carried, so `writeId` is cleared; the same text keeps it.
   */
  abstract update(id: string, baseRevision: number, text: string): Promise<WikiDraft | undefined>;
  /**
   * Gives the draft another page id: its text (which carries it) and `pageId`, and a new revision so a client that still
   * holds the old text is told; undefined when the revision has moved on. The write it was published with is let go.
   */
  abstract reissueId(id: string, baseRevision: number, text: string, pageId: string): Promise<WikiDraft | undefined>;
  /** Sets or clears the write that published the draft. */
  abstract setWrite(id: string, writeId: string | null): Promise<void>;
  abstract remove(id: string): Promise<boolean>;
  /** The drafts of a person in a project, newest touched first. */
  abstract listOf(projectId: string, userId: string): Promise<WikiDraft[]>;
  /**
   * The other people who have a draft of the page touched since `since` (an ISO time), newest first, and who still hold
   * Project Access; their text stays where it is.
   */
  abstract othersOn(projectId: string, path: string, exceptUserId: string, since: string): Promise<WikiPresence[]>;
}

export abstract class WikiAttachments {
  /** Adds the file to the draft, replacing one of the same name. */
  abstract put(draftId: string, file: { name: string; contentType: string; bytes: Buffer }): Promise<WikiAttachment>;
  abstract list(draftId: string): Promise<WikiAttachment[]>;
  /** Every file of the draft with its bytes, by name. */
  abstract readAll(draftId: string): Promise<Array<{ name: string; contentType: string; bytes: Buffer }>>;
  abstract read(draftId: string, name: string): Promise<{ contentType: string; bytes: Buffer } | undefined>;
  abstract remove(draftId: string, name: string): Promise<boolean>;
}

export abstract class WikiIdCounters {
  /** The next number of `scope` in the project, starting at 1; every call hands out a number no other call gets. */
  abstract next(projectId: string, scope: string): Promise<number>;
  /** Raises the counter so the next number is above `highest`; never lowers it. A scope never used starts here. */
  abstract startAfter(projectId: string, scope: string, highest: number): Promise<void>;
  /** The highest number of a page id of `scope` the Brain's index holds in the project; 0 when it holds none. */
  abstract highestInBrain(projectId: string, scope: string): Promise<number>;
}

export abstract class WikiRestrictions {
  /** Every restriction of the project, by prefix. */
  abstract list(projectId: string): Promise<WikiRestriction[]>;
  /** The restrictions whose prefix covers the path: the path itself, or a folder above it. */
  abstract covering(projectId: string, path: string): Promise<WikiRestriction[]>;
  /** Adds the restriction; the same one again changes nothing. */
  abstract add(input: { projectId: string; pathPrefix: string; subjectKind: WikiSubjectKind; subjectId: string; kind: WikiRestrictionKind; createdBy: string | null }): Promise<WikiRestriction>;
  /** Makes `subjects` exactly who the prefix lets in for the kind, in one step: the rows it had are replaced. */
  abstract replace(input: { projectId: string; pathPrefix: string; kind: WikiRestrictionKind; subjects: ReadonlyArray<{ kind: WikiSubjectKind; id: string }>; createdBy: string | null }): Promise<WikiRestriction[]>;
  /** Removes every row of the prefix and kind; the number removed. */
  abstract clear(projectId: string, pathPrefix: string, kind: WikiRestrictionKind): Promise<number>;
}

/** A person the editor may suggest for a mention: no email, only the name a comment shows. */
export interface WikiPerson {
  id: string;
  username: string;
  displayName: string;
}

/** The people a mention can name: those with Project Access on the project, enabled. */
export abstract class WikiPeople {
  /** Up to `limit` people whose username or display name holds `query` (case-insensitive), the ones that start with it first. */
  abstract search(projectId: string, query: string, limit: number): Promise<WikiPerson[]>;
  /** The people with these usernames (lower case); a name that is nobody's and one without access are not told apart. */
  abstract byUsernames(projectId: string, usernames: readonly string[]): Promise<Array<{ id: string; username: string }>>;
}

/** The people and roles restrictions name. */
export abstract class WikiSubjects {
  /** The ids of the roles a user holds. */
  abstract rolesOf(userId: string): Promise<string[]>;
  /** The names to show for users (their display name, or sign-in name) and roles; an id that does not exist is missing from the map. */
  abstract names(kind: WikiSubjectKind, ids: readonly string[]): Promise<Map<string, string>>;
}

/** The most watches a person has in a project. */
export const WIKI_WATCH_LIMIT = 500;

export abstract class WikiWatches {
  /** The watches of a person in a project, newest first. */
  abstract listOf(projectId: string, userId: string): Promise<WikiWatch[]>;
  /** Watches the target; whether it is new (a second time changes nothing), or undefined at the limit of watches. */
  abstract add(projectId: string, userId: string, scopeKind: WikiWatchScope, target: string): Promise<{ created: boolean } | undefined>;
  /** Stops watching; whether there was a watch. */
  abstract remove(projectId: string, userId: string, scopeKind: WikiWatchScope, target: string): Promise<boolean>;
  /** The people who watch any of these targets (a page, a folder or a space), once each. */
  abstract watchersOf(projectId: string, targets: ReadonlyArray<{ scopeKind: WikiWatchScope; target: string }>): Promise<string[]>;
  /** The watches of the person among these targets. */
  abstract among(projectId: string, userId: string, targets: ReadonlyArray<{ scopeKind: WikiWatchScope; target: string }>): Promise<WikiWatch[]>;
}

export abstract class WikiComments {
  /**
   * Records the comment. The same person sending the same text for the same page and parent again within a few seconds
   * (a double click) gets the first comment back, and a page that holds the most open comments takes no more.
   */
  abstract createOnce(comment: NewWikiComment): Promise<{ comment: WikiCommentRow; duplicate: boolean } | { tooMany: true }>;
  abstract find(projectId: string, id: string): Promise<WikiCommentRow | undefined>;
  /**
   * Resolves or reopens a comment; reopening is refused (`tooMany`) when the page already holds the most open comments.
   * Undefined when the comment is gone.
   */
  abstract setStatus(projectId: string, id: string, status: "open" | "resolved", userId: string): Promise<WikiCommentRow | { tooMany: true } | undefined>;
  /** Replaces the text and marks the comment edited; undefined when it is gone. */
  abstract edit(projectId: string, id: string, body: string): Promise<WikiCommentRow | undefined>;
  /** Whether a comment that is not deleted answers this one. */
  abstract hasReplies(projectId: string, id: string): Promise<boolean>;
  /** Deletes a comment by blanking it: the row stays, marked deleted with an empty text, so its answers keep their place. */
  abstract remove(projectId: string, id: string): Promise<boolean>;
  /**
   * The comments of a page in time order, `limit` of them after the comment `after`; a deleted comment is there only while an
   * answer to it is. `next` is the `after` of the following page, or null.
   */
  abstract listOfPage(projectId: string, pageKey: string, limit: number, after: string | undefined): Promise<{ rows: WikiCommentRow[]; next: string | null }>;
}

/** One publish of a page at a time per project: two people publishing at once cannot both open a write for it. */
export abstract class WikiPageLocks {
  /** Runs `work` while holding the lock of the page; others asking for it wait their turn. */
  abstract withLock<T>(projectId: string, path: string, work: () => Promise<T>): Promise<T>;
}

/** Where a page may be published straight to the default branch. */
export abstract class WikiDirectPublish {
  /** The globs of `directPublishPaths` in kintsugi.yaml at the head of the default branch; none when there are none or the file cannot be read. */
  abstract globs(projectId: string): Promise<readonly string[]>;
}
