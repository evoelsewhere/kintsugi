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
  /** Removes every row of the prefix and kind; the number removed. */
  abstract clear(projectId: string, pathPrefix: string, kind: WikiRestrictionKind): Promise<number>;
}
