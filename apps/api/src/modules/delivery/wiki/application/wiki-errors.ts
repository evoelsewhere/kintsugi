// The answers of the wiki routes that an editor acts on: each carries a `details.code` the portal reads.

import { ConflictException } from "@nestjs/common";
import type { WikiHead } from "../domain/wiki.js";

/** The 409 of a save or publish whose revision is not the stored one (0: there is no draft). The editor reads `details.revision`. */
export function revisionConflict(revision: number): ConflictException {
  return new ConflictException({
    message: revision === 0 ? "The draft is gone; read the page again" : `The draft is at revision ${revision}: it was saved from another tab or window`,
    details: { code: "draft-revision", revision },
  });
}

/** The 409 of a publish whose changes meet the page's changes since the draft started: all three texts, and where they meet. */
export function mergeConflict(texts: { base: string; ours: string; theirs: string }, head: WikiHead, regions: ReadonlyArray<{ baseStart: number; baseEnd: number }>): ConflictException {
  return new ConflictException({
    message: "Your changes and the changes made since you started editing meet in the same lines; resolve them to publish",
    details: { code: "conflict", ...texts, head, regions: regions.map(({ baseStart, baseEnd }) => ({ baseStart, baseEnd })) },
  });
}

/** The 409 of a publish of a page another person (or an earlier, unfinished publish of the same person) has a write open for. */
export function openWriteConflict(write: { id: string; author: string | null; prUrl: string | null }): ConflictException {
  const waiting = write.prUrl === null ? "a write that is still being processed" : `the pull request ${write.prUrl}`;
  return new ConflictException({
    message: `This page already has ${waiting}${write.author === null ? "" : `, started by ${write.author}`}; it must be merged or closed before another change can be published`,
    details: { code: "open-write", write },
  });
}
