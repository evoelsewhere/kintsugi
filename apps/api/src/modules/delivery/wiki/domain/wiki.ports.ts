// Ports of the wiki's working state (ADR-0098, ADR-0099); the Pg adapters implement them.

import type { NewWikiDraft, WikiAttachment, WikiDraft, WikiPresence, WikiRestriction, WikiRestrictionKind, WikiSubjectKind } from "./wiki.js";

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

/** The people and roles restrictions name. */
export abstract class WikiSubjects {
  /** The ids of the roles a user holds. */
  abstract rolesOf(userId: string): Promise<string[]>;
  /** The names to show for users (their display name, or sign-in name) and roles; an id that does not exist is missing from the map. */
  abstract names(kind: WikiSubjectKind, ids: readonly string[]): Promise<Map<string, string>>;
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
