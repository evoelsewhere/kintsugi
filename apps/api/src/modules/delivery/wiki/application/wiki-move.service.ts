// Moving or renaming a page without breaking a link (AUT-13, AUT-14, AUT-54, ADR-0098 decision 5). The pages that link to
// it are found in the Brain, read at the head of the default branch and rewritten by the pure planner of the domain
// (`planMove`); the result is ONE write of kind `page`: an entry that moves the page and an entry for each page whose
// links changed. A preview answers what would change and writes nothing.

import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { type PageMoveEntry, type PageMoveRefusal, type PageFile, isWikiEditablePath, pageIdOf, planMove } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import type { DocumentWriteFile } from "#modules/admin/document-writes/index.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { WikiAccessService } from "./wiki-access.service.js";

/** The most entries one move may write (the git core refuses more): the page, the pages that link to it, two home pages. */
export const MOVE_ENTRY_LIMIT = 500;
/** Links the Brain gives per window while the pages that link to a page are collected. */
const BACKLINK_WINDOW = 100;

/** What a move would change: the page and every page whose links are rewritten. */
export interface WikiMovePreview {
  entries: Array<{ path: string; renameFrom?: string; kind: "moved" | "rewritten" }>;
  rewrittenLinks: number;
}

/** The write a move made; the portal shows it as it shows a publish. */
export interface WikiMoveResult {
  outcome: "published";
  write: { id: string; status: string; mode: "pull-request" | "direct"; branch?: string; prUrl?: string };
}

interface Plan {
  from: string;
  to: string;
  entries: PageMoveEntry[];
  rewrittenLinks: number;
  /** The text of each page as it is at the head, which the hash of its entry is taken from. */
  heads: Map<string, string>;
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
/** A Markdown page the wiki may write: not `restricted/`, `_generated/`, a hidden folder or a file of another type, and no `..`. */
const isMovablePage = (path: string): boolean => isWikiEditablePath(path) && path.toLowerCase().endsWith(".md");

@Injectable()
export class WikiMoveService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly documents: DocumentsService,
    private readonly brain: BrainService,
    private readonly writes: DocumentWritesService,
    private readonly audit: AuditTrail,
  ) {}

  /** What a move would change; nothing is written and nothing is audited. */
  async preview(projectId: string, input: { from: string; to: string }): Promise<WikiMovePreview> {
    const plan = await this.#plan(projectId, input.from, input.to);
    return {
      entries: plan.entries.map((entry) => ({ path: entry.path, ...(entry.renameFrom === undefined ? {} : { renameFrom: entry.renameFrom }), kind: entry.renameFrom === undefined ? ("rewritten" as const) : ("moved" as const) })),
      rewrittenLinks: plan.rewrittenLinks,
    };
  }

  /**
   * Moves the page and rewrites the links to it in one write. Every path the move touches needs `wiki.write` and
   * satisfies the restrictions that cover it; a refusal names the path and is audited. A page with a write still waiting
   * for review is not touched: 409 `open-write` names it.
   */
  async move(projectId: string, actor: Actor, input: { from: string; to: string; message: string }): Promise<WikiMoveResult> {
    this.access.assertHasWritePermission(actor);
    const plan = await this.#plan(projectId, input.from, input.to);
    let direct = true;
    for (const path of new Set([plan.from, plan.to, ...plan.entries.map((entry) => entry.path)])) {
      try {
        direct = (await this.access.assertCanPublish(projectId, actor, path)).direct && direct;
      } catch (error) {
        if (error instanceof ForbiddenException) {
          const body = error.getResponse();
          const details = typeof body === "object" && body !== null ? (body as { details?: unknown }).details : undefined;
          throw new ForbiddenException({ message: `Cannot move ${plan.from}: ${path}: ${error.message}`, ...(details === undefined ? {} : { details }) });
        }
        throw error;
      }
    }
    for (const path of new Set([plan.from, plan.to, ...plan.entries.map((entry) => entry.path)])) {
      const open = await this.writes.openPageWrite(projectId, path);
      if (open !== undefined) {
        throw new ConflictException({ message: `${path} has a change waiting for review (write ${open.id}); wait for it to be merged or closed before moving ${plan.from}`, details: { code: "open-write", path, writeId: open.id } });
      }
    }

    const files: DocumentWriteFile[] = plan.entries.map((entry) => {
      const was = entry.renameFrom ?? entry.path;
      return { path: entry.path, ...(entry.renameFrom === undefined ? {} : { renameFrom: entry.renameFrom }), content: entry.text, expectedHash: sha256(plan.heads.get(was) ?? "") };
    });
    const moved = plan.entries.find((entry) => entry.renameFrom !== undefined);
    const write = await this.writes.proposePage(
      projectId,
      { message: input.message, files, page: { id: pageIdOf(moved?.text ?? "") ?? null, path: plan.to, minor: false }, ...(direct ? { directPublish: true } : {}) },
      actor,
    );
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.wikiPageMove, {
        projectId,
        subject: plan.to,
        detail: { from: plan.from, to: plan.to, mode: direct ? "direct" : "pull-request", writeId: write.id, rewritten: plan.entries.length - 1, rewrittenLinks: plan.rewrittenLinks },
      }),
    );
    return { outcome: "published", write: { id: write.id, status: write.status, mode: direct ? "direct" : "pull-request", ...(write.branch === undefined ? {} : { branch: write.branch }), ...(write.prUrl === undefined ? {} : { prUrl: write.prUrl }) } };
  }

  async #plan(projectId: string, from: string, to: string): Promise<Plan> {
    if (from === to) throw new BadRequestException(`${from} is already there`);
    // Before anything is read: what is not a page of the wiki is refused the same whether it exists or not, so the answer says nothing of what is there.
    for (const path of [from, to]) if (!isMovablePage(path)) throw new BadRequestException(`${path} is not a page the wiki can write`);
    const heads = new Map<string, string>();
    const read = async (path: string): Promise<string | undefined> => {
      if (heads.has(path)) return heads.get(path);
      try {
        const file = await this.documents.file(projectId, undefined, path);
        heads.set(path, file.content);
        return file.content;
      } catch (error) {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      }
    };
    const source = await read(from);
    if (source === undefined) throw new NotFoundException(`${from} does not exist at the head of the default branch`);
    // A target that is there, of any kind, is not written over.
    const target = await this.documents.file(projectId, undefined, to).then(
      () => true,
      (error: unknown) => !(error instanceof NotFoundException),
    );
    if (target) throw targetExists(to);

    // The pages that link to the page or to a heading of it, from the Brain's links, then read at the head: a page whose
    // text changed since the index is planned as it is now.
    const linking = new Set<string>();
    for (let offset = 0; ; ) {
      const view = await this.brain.backlinks(projectId, { node: from, offset, limit: BACKLINK_WINDOW });
      for (const item of view.items) if (item.node.path !== from) linking.add(item.node.path);
      if (linking.size >= MOVE_ENTRY_LIMIT) throw tooMany(linking.size + 1);
      if (view.nextOffset === null) break;
      offset = view.nextOffset;
    }
    const files: PageFile[] = [{ path: from, text: source }];
    for (const path of [...linking].sort()) {
      const text = await read(path);
      if (text !== undefined) files.push({ path, text });
    }
    // The home pages of the folders the page leaves and joins, whose `order` lists follow it.
    for (const folder of new Set([folderOf(from), folderOf(to)])) {
      for (const name of ["README.md", "index.md"]) {
        const path = folder === "" ? name : `${folder}/${name}`;
        if (files.some((file) => file.path === path)) continue;
        const text = await read(path);
        if (text !== undefined) {
          files.push({ path, text });
          break;
        }
      }
    }

    const plan = planMove({ moves: [{ from, to }], files });
    if ("error" in plan) throw refusal(plan.error, plan.path, from);
    if (plan.entries.length > MOVE_ENTRY_LIMIT) throw tooMany(plan.entries.length);
    return { from, to, entries: plan.entries, rewrittenLinks: plan.rewrittenLinks, heads };
  }
}

function tooMany(count: number): ConflictException {
  return new ConflictException({ message: `Too many pages link here (${count}, the limit is ${MOVE_ENTRY_LIMIT})`, details: { code: "too-many", count, limit: MOVE_ENTRY_LIMIT } });
}

function targetExists(path: string): ConflictException {
  return new ConflictException({ message: `${path} already exists`, details: { code: "target-exists", path } });
}

/** A refusal of the planner as an HTTP answer: a target that exists is a conflict, anything else a bad request. */
function refusal(error: PageMoveRefusal, path: string, from: string): ConflictException | BadRequestException {
  if (error === "target-exists") return targetExists(path);
  const reasons: Record<Exclude<PageMoveRefusal, "target-exists">, string> = {
    "outside-wiki": `${path} is not a page the wiki can write`,
    "same-path": `${from} is already there`,
    cycle: `${path} is both moved and a target`,
    "missing-source": `${path} was not read`,
    "duplicate-source": `${path} is moved twice`,
  };
  return new BadRequestException(reasons[error]);
}
