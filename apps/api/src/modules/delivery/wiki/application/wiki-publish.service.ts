// Publishing a draft (ADR-0098 decisions 3 and 4, design-wiki-draft-publish section 3). A publish is one write of kind
// `page` for the document writer, which opens a pull request or, where the manifest allows, commits to the default
// branch. When the page moved since the draft started, the draft is merged three ways with the page first and nothing
// is written until the person has seen the result: a clean merge is a preview they confirm, a conflict is theirs to resolve.

import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { mergeText, pageId as makePageId, pageIdOf, parsePageId } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { type DocumentWriteFile, DocumentWritesService } from "#modules/admin/document-writes/index.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import type { WikiDraft, WikiHead, WikiPublishResult } from "../domain/wiki.js";
import { withPageId } from "../domain/wiki.page-id.js";
import { WikiDrafts, WikiIdCounters, WikiPageLocks } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";
import { WikiAttachmentService } from "./wiki-attachment.service.js";
import { DRAFT_TEXT_MAX_BYTES } from "./wiki-draft.service.js";
import { mergeConflict, openWriteConflict, revisionConflict } from "./wiki-errors.js";

export interface PublishInput {
  path: string;
  /** The revision of the draft the person is publishing. */
  revision: number;
  message: string;
  minor?: boolean | undefined;
  /** The page as the person saw it in the preview or the conflict; the publish goes ahead only if it is still so. */
  mergedFrom?: { commit: string; hash: string | null } | undefined;
  /** The person's resolution of a conflict; needs `mergedFrom`. */
  resolvedText?: string | undefined;
}

const sha256 = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

@Injectable()
export class WikiPublishService {
  constructor(
    private readonly drafts: WikiDrafts,
    private readonly documents: DocumentsService,
    private readonly writes: DocumentWritesService,
    private readonly access: WikiAccessService,
    private readonly attachments: WikiAttachmentService,
    private readonly locks: WikiPageLocks,
    private readonly counters: WikiIdCounters,
    private readonly audit: AuditTrail,
  ) {}

  async publish(projectId: string, actor: Actor, input: PublishInput): Promise<WikiPublishResult> {
    const { direct } = await this.access.assertCanPublish(projectId, actor, input.path);
    if (!input.path.toLowerCase().endsWith(".md")) throw new BadRequestException(`${input.path} is not a page that can be published as text`);
    if (input.resolvedText !== undefined) {
      if (input.mergedFrom === undefined) throw new BadRequestException("resolvedText needs mergedFrom, the page as the conflict showed it");
      if (Buffer.byteLength(input.resolvedText, "utf8") > DRAFT_TEXT_MAX_BYTES) throw new BadRequestException(`A page is at most ${DRAFT_TEXT_MAX_BYTES / (1024 * 1024)} MiB of text`);
    }
    // From the head being read to the write being recorded, one publish of the page at a time.
    return this.locks.withLock(projectId, input.path, () => this.#publish(projectId, actor, input, direct));
  }

  async #publish(projectId: string, actor: Actor, input: PublishInput, direct: boolean): Promise<WikiPublishResult> {
    const draft = await this.drafts.find(projectId, actor.id, input.path);
    if (draft === undefined) throw new NotFoundException(`You have no draft of ${input.path} to publish`);
    if (draft.revision !== input.revision) throw revisionConflict(draft.revision);

    const context = await this.documents.context(projectId);
    const { defaultTip } = await this.documents.branchTips(context);
    if (defaultTip === undefined) throw new BadRequestException("The document repo has no default branch to publish to yet");
    const headPage = await this.documents.readPage(context, defaultTip.commit, input.path, DRAFT_TEXT_MAX_BYTES);
    const head: WikiHead = { commit: defaultTip.commit, hash: headPage?.hash ?? null };
    // The files the draft carries beside the page go in the same write, as new files under the page's `_attachments/` folder.
    const attachments = await this.attachments.asWrites(draft);
    const publish = async (text: string): Promise<WikiPublishResult> => {
      await this.#requireFreeId(projectId, context, defaultTip.commit, draft, input.path, text, head.hash === null);
      return this.#record(projectId, actor, input, draft, [{ path: input.path, content: text, ...(head.hash === null ? { createOnly: true } : { expectedHash: head.hash }) }, ...attachments], text, direct);
    };
    // The page says what the draft says already: only the attachments, if there are any, are left to publish.
    const unchanged = (): Promise<WikiPublishResult> => (attachments.length === 0 ? Promise.resolve({ outcome: "unchanged" }) : this.#record(projectId, actor, input, draft, attachments, headPage?.text ?? draft.text, direct));

    // The person resolved a conflict against the page as it still is: publish what they made of it, and let the writer
    // refuse if the page changes in the meantime.
    if (input.resolvedText !== undefined && input.mergedFrom?.hash === head.hash) return publish(input.resolvedText);

    if (sha256(draft.text) === head.hash) return unchanged();
    // Nobody touched the page since the draft started.
    if (head.hash === draft.baseHash) return publish(draft.text);

    // The page moved: merge the draft with it, from the page as the draft started.
    const basePage = draft.baseCommit === null || draft.baseHash === null ? undefined : await this.documents.readPage(context, draft.baseCommit, input.path, DRAFT_TEXT_MAX_BYTES);
    const base = basePage?.text ?? "";
    const theirs = headPage?.text ?? "";
    const merged = mergeText(base, draft.text, theirs);
    if (!merged.clean) throw mergeConflict({ base, ours: draft.text, theirs }, head, merged.regions);
    if (merged.merged === theirs && headPage !== undefined) return unchanged();
    // A clean merge is shown first; the person confirms it by sending the page it was made against.
    if (input.mergedFrom?.hash === head.hash && input.resolvedText === undefined) return publish(merged.merged);
    return { outcome: "merge-preview", merged: merged.merged, head, base: { commit: draft.baseCommit, hash: draft.baseHash } };
  }

  /**
   * The page id the text gives must not be one another page holds: at the head of the default branch, or in a write that is
   * open for another page (not on the branch yet, so the writer cannot see it). When it is, nothing is written and the answer
   * names the page that holds the id. A page that is new at the head is also given the next free id of its scope, in its text
   * and its page id, so the next publish goes on with it; a page that exists keeps its id, which is the address the links to it
   * use, and is left for its author to look at. The writer checks again.
   */
  async #requireFreeId(projectId: string, context: DocumentContext, commit: string, draft: WikiDraft, path: string, text: string, isNew: boolean): Promise<void> {
    const id = pageIdOf(text);
    if (id === undefined) return;
    const owner = await this.#ownerOf(projectId, context, commit, id, path);
    if (owner === undefined) return;
    const scope = isNew ? parsePageId(id)?.key : undefined;
    const rewritten = scope === undefined ? undefined : await this.#nextFree(projectId, context, commit, scope, path);
    const text2 = rewritten === undefined ? undefined : withPageId(draft.text, rewritten);
    const updated = rewritten === undefined || text2 === undefined ? undefined : await this.drafts.reissueId(draft.id, draft.revision, text2, rewritten);
    throw new ConflictException({
      message: `The page id ${id} is already defined by ${owner}${updated === undefined ? "" : `; the draft now has the id ${updated.pageId}: publish it again`}`,
      details: { code: "id-taken", path: owner, ...(updated === undefined ? {} : { pageId: updated.pageId, revision: updated.revision }) },
    });
  }

  /** The path of another page that holds the id: a file at the head of the default branch, else an open write. */
  async #ownerOf(projectId: string, context: DocumentContext, commit: string, id: string, path: string): Promise<string | undefined> {
    const found = await this.documents.grep(context, commit, [id], { ignoreCase: false, limit: 50 });
    for (const file of [...new Set(found.matches.map((match) => match.path))]) {
      if (file === path || !file.toLowerCase().endsWith(".md")) continue;
      const page = await this.documents.readPage(context, commit, file, DRAFT_TEXT_MAX_BYTES).catch(() => undefined);
      if (page !== undefined && pageIdOf(page.text) === id) return file;
    }
    return (await this.writes.openPageWriteOfId(projectId, id, path))?.page?.path;
  }

  /** The next id of the scope that no page holds, from the counter (one atomic statement per try). */
  async #nextFree(projectId: string, context: DocumentContext, commit: string, scope: string, path: string): Promise<string | undefined> {
    await this.counters.startAfter(projectId, scope, await this.counters.highestInBrain(projectId, scope));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = makePageId(scope, await this.counters.next(projectId, scope));
      if ((await this.#ownerOf(projectId, context, commit, candidate, path)) === undefined) return candidate;
    }
    return undefined;
  }

  /** Records the write of `files` (one open write per page), gives its id to the draft and audits the publish; `text` is the page, for its id. */
  async #record(projectId: string, actor: Actor, input: PublishInput, draft: WikiDraft, files: DocumentWriteFile[], text: string, direct: boolean): Promise<WikiPublishResult> {
    const author = actor.username ?? actor.id;
    const open = await this.writes.openPageWrite(projectId, input.path);
    // The person's own earlier write of the page, once it has a review branch, is continued; anyone else's, or one not yet
    // on a branch, has to finish first.
    if (open !== undefined && (open.actor !== author || open.branch === undefined)) throw openWriteConflict({ id: open.id, author: open.actor ?? null, prUrl: open.prUrl ?? null });
    const pageId = pageIdOf(text) ?? draft.pageId;
    const write = await this.writes.proposePage(
      projectId,
      {
        message: input.message,
        files,
        page: { id: pageId, path: input.path, minor: input.minor === true },
        ...(direct ? { directPublish: true } : {}),
        ...(open?.branch === undefined ? {} : { continues: open.branch }),
      },
      actor,
    );
    await this.drafts.setWrite(draft.id, write.id);
    const mode = direct ? "direct" : "pull-request";
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.wikiPagePublish, { projectId, subject: input.path, detail: { path: input.path, mode, writeId: write.id, pageId } }));
    return { outcome: "published", write: { id: write.id, status: write.status, mode, ...(write.branch === undefined ? {} : { branch: write.branch }), ...(write.prUrl === undefined ? {} : { prUrl: write.prUrl }) } };
  }
}
