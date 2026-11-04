// A person's drafts of wiki pages (ADR-0098 decision 2): the text between keystrokes and publication lives in Postgres.
// Autosave only writes this table; it never reaches the document writer, which publishes (a separate, explicit step).

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { isWikiEditablePath } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { sqlStateOf } from "#common/db/errors.js";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import type { WikiDraft, WikiDraftSummary, WikiDraftView } from "../domain/wiki.js";
import { WikiDrafts } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";

/** The most bytes of a draft's text: a page is written as one file of at most this size (the write contract's limit). */
export const DRAFT_TEXT_MAX_BYTES = 5 * 1024 * 1024;
/** Someone who touched the page within this long is working on it now. */
export const PRESENCE_WINDOW_MS = 120_000;

export interface SaveDraftInput {
  path: string;
  text: string;
  /** The revision the caller last saw; null for the first save. */
  baseRevision: number | null;
  /** First save only: the commit of the default branch the text was read from. */
  baseCommit?: string | undefined;
}

@Injectable()
export class WikiDraftService {
  constructor(
    private readonly drafts: WikiDrafts,
    private readonly documents: DocumentsService,
    private readonly writes: DocumentWritesService,
    private readonly access: WikiAccessService,
  ) {}

  /** The caller's draft of the page, or 404; one whose write has landed is removed first. */
  async get(projectId: string, actor: Actor, path: string): Promise<WikiDraftView> {
    const draft = await this.#settled(projectId, actor.id, path);
    if (draft === undefined) throw new NotFoundException(`You have no draft of ${path}`);
    return this.#view(draft, actor.id);
  }

  /**
   * Saves the text. The first save creates the draft at revision 1 with the base the text was read from (`baseCommit`,
   * never the head of the branch at save time, so a reader whose text is older than the head is merged, not
   * overwritten); later saves must name the stored revision, and a stale one is a 409 the editor resolves.
   */
  async save(projectId: string, actor: Actor, input: SaveDraftInput): Promise<WikiDraftView> {
    this.access.assertCanWrite(actor, input.path);
    if (!isWikiEditablePath(input.path) || !input.path.toLowerCase().endsWith(".md")) throw new BadRequestException(`${input.path} is not a page that can be edited`);
    if (Buffer.byteLength(input.text, "utf8") > DRAFT_TEXT_MAX_BYTES) throw new BadRequestException(`A page is at most ${DRAFT_TEXT_MAX_BYTES / (1024 * 1024)} MiB of text`);

    const stored = await this.#settled(projectId, actor.id, input.path);
    if (stored === undefined) {
      if (input.baseRevision !== null) throw revisionConflict(0);
      const base = await this.#base(projectId, input.path, input.baseCommit);
      try {
        const created = await this.drafts.create({ projectId, userId: actor.id, path: input.path, pageId: null, text: input.text, baseCommit: base.commit, baseHash: base.hash });
        return await this.#view(created, actor.id);
      } catch (error) {
        // Two tabs created the draft at once: the other one won.
        if (sqlStateOf(error) === "23505") throw revisionConflict((await this.drafts.find(projectId, actor.id, input.path))?.revision ?? 0);
        throw error;
      }
    }
    if (input.baseRevision !== stored.revision) throw revisionConflict(stored.revision);
    const updated = await this.drafts.update(stored.id, stored.revision, input.text);
    if (updated === undefined) throw revisionConflict((await this.drafts.find(projectId, actor.id, input.path))?.revision ?? 0);
    return this.#view(updated, actor.id);
  }

  /** Discards the caller's draft of the page (nothing happens when there is none). */
  async discard(projectId: string, actor: Actor, path: string): Promise<void> {
    this.access.assertCanWrite(actor, path);
    const draft = await this.drafts.find(projectId, actor.id, path);
    if (draft !== undefined) await this.drafts.remove(draft.id);
  }

  /** The caller's drafts in the project, the newest touched first. */
  async list(projectId: string, actor: Actor): Promise<WikiDraftSummary[]> {
    const summaries: WikiDraftSummary[] = [];
    for (const stored of await this.drafts.listOf(projectId, actor.id)) {
      const draft = await this.#settle(stored);
      if (draft !== undefined) summaries.push({ path: draft.path, touchedAt: draft.touchedAt, revision: draft.revision, writeId: draft.writeId });
    }
    return summaries;
  }

  async #settled(projectId: string, userId: string, path: string): Promise<WikiDraft | undefined> {
    const stored = await this.drafts.find(projectId, userId, path);
    return stored === undefined ? undefined : this.#settle(stored);
  }

  /**
   * What became of the write a draft was published with. Landed on the default branch (merged, committed without a
   * review branch, or found unchanged): the draft has done its work and goes. Closed without a merge, failed or gone: the
   * draft stays and loses the write, so its author can change it and publish again. Waiting for review: both stay.
   */
  async #settle(draft: WikiDraft): Promise<WikiDraft | undefined> {
    if (draft.writeId === null) return draft;
    const write = await this.writes.find(draft.projectId, draft.writeId);
    const landed = write !== undefined && (write.status === "merged" || write.status === "unchanged" || (write.status === "committed" && write.branch === undefined));
    if (landed) {
      await this.drafts.remove(draft.id);
      return undefined;
    }
    if (write === undefined || write.status === "closed" || write.status === "failed") {
      await this.drafts.setWrite(draft.id, null);
      return { ...draft, writeId: null };
    }
    return draft;
  }

  /** The commit a first save is based on and the hash of the page there. */
  async #base(projectId: string, path: string, baseCommit: string | undefined): Promise<{ commit: string | null; hash: string | null }> {
    const context = await this.documents.context(projectId);
    const { defaultTip } = await this.documents.branchTips(context);
    if (baseCommit === undefined) {
      // No base given: only a page that does not exist yet can start without one.
      if (defaultTip !== undefined && (await this.documents.hashAt(context, defaultTip.commit, path, DRAFT_TEXT_MAX_BYTES)) !== undefined) {
        throw new BadRequestException(`${path} exists: the first save of a draft names baseCommit, the commit its text was read from`);
      }
      return { commit: null, hash: null };
    }
    await this.#requireOnDefaultBranch(context, defaultTip?.commit, baseCommit);
    return { commit: baseCommit, hash: (await this.documents.hashAt(context, baseCommit, path, DRAFT_TEXT_MAX_BYTES)) ?? null };
  }

  async #requireOnDefaultBranch(context: DocumentContext, tip: string | undefined, commit: string): Promise<void> {
    const known = await this.documents.resolve(context, commit).then(
      () => true,
      (error: unknown) => (error instanceof NotFoundException ? false : Promise.reject(error)),
    );
    if (!known) throw new BadRequestException(`baseCommit ${commit} is not a commit of the document repo mirror`);
    if (tip === undefined || !(await this.documents.isAncestor(context, commit, tip))) throw new BadRequestException(`baseCommit ${commit} is not in the history of the default branch`);
  }

  async #view(draft: WikiDraft, userId: string): Promise<WikiDraftView> {
    const others = await this.drafts.othersOn(draft.projectId, draft.path, userId, new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString());
    return {
      path: draft.path,
      pageId: draft.pageId,
      text: draft.text,
      revision: draft.revision,
      baseCommit: draft.baseCommit,
      baseHash: draft.baseHash,
      touchedAt: draft.touchedAt,
      writeId: draft.writeId,
      others,
    };
  }
}

/** The 409 of a save whose revision is not the stored one (0: there is no draft). The editor reads `details.revision`. */
function revisionConflict(revision: number): ConflictException {
  return new ConflictException({
    message: revision === 0 ? "The draft is gone; read the page again" : `The draft is at revision ${revision}: it was saved from another tab or window`,
    details: { code: "draft-revision", revision },
  });
}
