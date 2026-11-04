// Deleting a page (ADR-0098, ADR-0099 decision 7, design-wiki-pages section 5): one write of kind `page` with a delete
// entry, and the page's name taken out of the `order:` list of its folder's home page when it is in one. The links that
// pointed at it become broken links, which the Brain reports after its next build; the number of them is counted first so
// the person is told what they leave behind.

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { HOME_PAGE_FILES, pageIdOf, withoutOrderEntry } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { DocumentWritesService, type DocumentWriteFile } from "#modules/admin/document-writes/index.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import { WikiPageLocks } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";
import { DRAFT_TEXT_MAX_BYTES } from "./wiki-draft.service.js";
import { openWriteConflict } from "./wiki-errors.js";

export interface DeleteInput {
  path: string;
  message: string;
}

/** What deleting a page came to: the write, and how many links into the page are left behind. */
export interface WikiDeleteResult {
  outcome: "published";
  write: { id: string; status: string; mode: "pull-request" | "direct"; branch?: string; prUrl?: string };
  brokenLinks: number;
}

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

@Injectable()
export class WikiDeleteService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly writes: DocumentWritesService,
    private readonly access: WikiAccessService,
    private readonly locks: WikiPageLocks,
    private readonly brain: BrainService,
    private readonly audit: AuditTrail,
  ) {}

  async delete(projectId: string, actor: Actor, input: DeleteInput): Promise<WikiDeleteResult> {
    const { direct } = await this.access.assertCanPublish(projectId, actor, input.path);
    if (!input.path.toLowerCase().endsWith(".md")) throw new BadRequestException(`${input.path} is not a page: only a Markdown page can be deleted here`);
    return this.locks.withLock(projectId, input.path, () => this.#delete(projectId, actor, input, direct));
  }

  async #delete(projectId: string, actor: Actor, input: DeleteInput, direct: boolean): Promise<WikiDeleteResult> {
    const open = await this.writes.openPageWrite(projectId, input.path);
    if (open !== undefined) throw openWriteConflict({ id: open.id, author: open.actor ?? null, prUrl: open.prUrl ?? null });

    const context = await this.documents.context(projectId);
    const { defaultTip } = await this.documents.branchTips(context);
    if (defaultTip === undefined) throw new BadRequestException("The document repo has no default branch yet");
    const page = await this.documents.readPage(context, defaultTip.commit, input.path, DRAFT_TEXT_MAX_BYTES);
    if (page === undefined) throw new NotFoundException(`${input.path} does not exist on the default branch`);

    const files: DocumentWriteFile[] = [{ path: input.path, content: "", delete: true, expectedHash: page.hash }];
    // The home page of the folder lists the page in its `order:`: it must not keep naming a page that is gone. Its own
    // path is checked like the page's, and it must have no write open: two pull requests would meet in that file.
    let directAll = direct;
    const home = await this.#homeOf(context, defaultTip.commit, input.path);
    if (home !== undefined) {
      const updated = withoutOrderEntry(home.text, nameOf(input.path));
      if (updated !== home.text) {
        directAll = (await this.access.assertCanPublish(projectId, actor, home.path)).direct && directAll;
        const homeOpen = await this.writes.openPageWrite(projectId, home.path);
        if (homeOpen !== undefined) throw openWriteConflict({ id: homeOpen.id, author: homeOpen.actor ?? null, prUrl: homeOpen.prUrl ?? null });
        files.push({ path: home.path, content: updated, expectedHash: home.hash });
      }
    }

    const brokenLinks = await this.#linksInto(projectId, input.path);
    const pageId = pageIdOf(page.text) ?? null;
    const write = await this.writes.proposePage(
      projectId,
      { message: input.message, files, page: { id: pageId, path: input.path, minor: false }, ...(directAll ? { directPublish: true } : {}) },
      actor,
    );
    const mode = directAll ? "direct" : "pull-request";
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.wikiPageDelete, { projectId, subject: input.path, detail: { path: input.path, mode, writeId: write.id, pageId, brokenLinks } }));
    return { outcome: "published", write: { id: write.id, status: write.status, mode, ...(write.branch === undefined ? {} : { branch: write.branch }), ...(write.prUrl === undefined ? {} : { prUrl: write.prUrl }) }, brokenLinks };
  }

  /** The home page (README.md, index.md…) of the page's folder at the commit, with its text and hash; undefined when the folder has none or the page is it. */
  async #homeOf(context: DocumentContext, commit: string, path: string): Promise<{ path: string; text: string; hash: string } | undefined> {
    const folder = folderOf(path);
    const names = await this.documents.listNames(context, commit, folder);
    const file = HOME_PAGE_FILES.find((name) => names.some((entry) => entry.kind === "file" && entry.name.toLowerCase() === name.toLowerCase()));
    if (file === undefined) return undefined;
    const homePath = folder === "" ? file : `${folder}/${file}`;
    if (homePath.toLowerCase() === path.toLowerCase()) return undefined;
    const real = names.find((entry) => entry.kind === "file" && entry.name.toLowerCase() === file.toLowerCase())?.name ?? file;
    const actualPath = folder === "" ? real : `${folder}/${real}`;
    const read = await this.documents.readPage(context, commit, actualPath, DRAFT_TEXT_MAX_BYTES);
    return read === undefined ? undefined : { path: actualPath, ...read };
  }

  /** The links from other pages into the page or its headings, as the Brain's last build knows them; none when there is no index to ask. */
  async #linksInto(projectId: string, path: string): Promise<number> {
    try {
      return (await this.brain.backlinks(projectId, { node: path, offset: 0, limit: 1 })).total;
    } catch {
      return 0;
    }
  }
}
