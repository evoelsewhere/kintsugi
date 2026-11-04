// Comments on wiki pages (ADR-0099 decision 1): rows of the database that belong to a project and a page, anchored to a
// passage of it or to the page as a whole, never written to Git. A comment is made by a person with `wiki.comment`, read by
// anyone with Project Access. An inline comment keeps the passage (`exact`) and what surrounds it, taken from the page as
// the Brain indexed it, which the server checks and the client cannot choose.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { pageIdOf, reanchor, reanchorAll } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { NotificationService } from "#modules/core/notifications/index.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { COMMENTS_OPEN_MAX, COMMENT_BODY_MAX, type WikiCommentAnchor, type WikiCommentList, type WikiCommentRow, type WikiCommentView } from "../domain/wiki.comment.js";
import { WikiComments, WikiWatches } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";
import { WikiPeopleService } from "./wiki-people.service.js";

/** The most watchers one comment notifies: a page that more people watch than this tells the first of them. */
const NOTIFY_MAX = 500;

/** The largest page a comment is made on: the one the editor can write. */
const PAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface CommentInput {
  path: string;
  body: string;
  anchor?: { node: string; exact: string; prefix?: string | undefined; suffix?: string | undefined } | undefined;
  parentId?: string | undefined;
}

@Injectable()
export class WikiCommentService {
  constructor(
    private readonly comments: WikiComments,
    private readonly documents: DocumentsService,
    private readonly brain: BrainService,
    private readonly access: WikiAccessService,
    private readonly people: WikiPeopleService,
    private readonly watches: WikiWatches,
    private readonly notifications: NotificationService,
    private readonly projectAccess: ProjectAccessService,
    private readonly audit: AuditTrail,
  ) {}

  readonly #log = new Logger(WikiCommentService.name);

  /** The comments of a page, in time order (`limit` of them after the comment `after`). */
  async list(projectId: string, path: string, limit: number, after: string | undefined): Promise<WikiCommentList> {
    const page = await this.#page(projectId, path);
    const found = await this.comments.listOfPage(projectId, page.key, limit, after);
    const placements = await this.#placements(projectId, path, found.rows);
    return { page: { key: page.key, path }, comments: found.rows.map((row) => toView(row, placements.get(row.id))), next: found.next };
  }

  /**
   * Writes a comment, or an answer to one. An inline comment names the heading or card it is under and the passage; the
   * passage must be in the page at the commit the Brain indexed, which the server records. The same words sent again within
   * a few seconds are the first comment, not a second.
   */
  async create(projectId: string, actor: Actor, input: CommentInput): Promise<WikiCommentView> {
    this.access.assertCanComment(actor);
    const body = input.body.trim();
    if (body === "") throw new BadRequestException("Write something to comment");
    if (body.length > COMMENT_BODY_MAX) throw new BadRequestException(`A comment is at most ${COMMENT_BODY_MAX} characters`);
    const page = await this.#page(projectId, input.path);

    if (input.parentId !== undefined) {
      if (input.anchor !== undefined) throw new BadRequestException("An answer is not anchored: it belongs to the comment it answers");
      const parent = await this.comments.find(projectId, input.parentId);
      if (parent === undefined || parent.pageKey !== page.key) throw new BadRequestException("The comment answered is not on this page");
      if (parent.parentId !== null) throw new BadRequestException("An answer cannot be answered: answer the comment it belongs to");
      if (parent.deletedAt !== null) throw new BadRequestException("The comment answered was deleted");
    }
    const placed = input.anchor === undefined ? undefined : await this.#place(projectId, input.path, input.anchor);

    const result = await this.comments.createOnce({
      projectId,
      pageKey: page.key,
      pathAtWrite: input.path,
      parentId: input.parentId ?? null,
      authorId: actor.id,
      body,
      anchor: placed?.anchor ?? null,
    });
    if ("tooMany" in result) {
      throw tooMany();
    }
    // A repeat of a comment (a double click) is not announced again; a failing notification never loses the comment.
    if (!result.duplicate) {
      await this.#notify(projectId, actor, page.key, input.path, result.comment, input.parentId === undefined ? undefined : (await this.comments.find(projectId, input.parentId))?.authorId).catch((error: unknown) =>
        this.#log.error(`Notifying about comment ${result.comment.id} failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    return toView(result.comment, placed === undefined ? undefined : { status: "anchored", line: placed.line });
  }

  /**
   * Resolves or reopens a comment (anyone with `wiki.comment`; a comment that is not an answer), or edits its text (its author
   * only). Both may be sent together. Reopening takes a place among the page's 200 open comments.
   */
  async update(projectId: string, actor: Actor, id: string, input: { resolved?: boolean | undefined; body?: string | undefined }): Promise<WikiCommentView> {
    this.access.assertCanComment(actor);
    let row = await this.#existing(projectId, id);
    if (input.body !== undefined) {
      if (row.authorId !== actor.id) throw new ForbiddenException("Only the author can edit a comment");
      const body = input.body.trim();
      if (body === "") throw new BadRequestException("Write something to comment");
      if (body.length > COMMENT_BODY_MAX) throw new BadRequestException(`A comment is at most ${COMMENT_BODY_MAX} characters`);
      const edited = await this.comments.edit(projectId, id, body);
      if (edited === undefined) throw gone(id);
      row = edited;
    }
    if (input.resolved !== undefined && (row.status === "resolved") !== input.resolved) {
      if (row.parentId !== null) throw new BadRequestException("An answer is resolved with the comment it answers");
      const result = await this.comments.setStatus(projectId, id, input.resolved ? "resolved" : "open", actor.id);
      if (result === undefined) throw gone(id);
      if ("tooMany" in result) throw tooMany();
      row = result;
    }
    const placements = await this.#placements(projectId, row.pathAtWrite, [row]);
    return toView(row, placements.get(row.id));
  }

  /**
   * Deletes a comment: its author may while nobody has answered it; someone with `wiki.manage` may delete any, and that is
   * audited (the path, the comment and its author, never the text). The row stays, blank, while it has answers.
   */
  async remove(projectId: string, actor: Actor, id: string): Promise<void> {
    const row = await this.#existing(projectId, id);
    const own = row.authorId === actor.id;
    const moderator = actor.permissions.includes("wiki.manage");
    if (!own && !moderator) throw new ForbiddenException("Only the author, or someone with wiki.manage, can delete a comment");
    if (own && !moderator && (await this.comments.hasReplies(projectId, id))) {
      throw new ConflictException({ message: "This comment has answers: it cannot be deleted by its author", details: { code: "has-replies" } });
    }
    if (!(await this.comments.remove(projectId, id))) throw gone(id);
    if (!own) {
      await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.wikiCommentDelete, { projectId, subject: id, detail: { path: row.pathAtWrite, commentId: id, authorId: row.authorId } }));
    }
  }

  /** A comment of the project that is not deleted; 404 otherwise. */
  async #existing(projectId: string, id: string): Promise<WikiCommentRow> {
    const row = await this.comments.find(projectId, id);
    if (row === undefined || row.deletedAt !== null) throw gone(id);
    return row;
  }

  /**
   * Where each inline comment's passage is now: placed again in the page at the commit the Brain indexed, from the quote.
   * Anchored in its own heading, moved to another one, or orphaned (the quote is nowhere: the comment is not lost, it keeps
   * its quote). Nothing is said while the Brain, or the page in it, is not there to place against: the comment then reads as it
   * was written.
   */
  async #placements(projectId: string, path: string, rows: readonly WikiCommentRow[]): Promise<Map<string, Placement>> {
    const inline = rows.filter((row) => row.anchor !== null && row.deletedAt === null);
    const placements = new Map<string, Placement>();
    if (inline.length === 0) return placements;
    let outline;
    try {
      outline = await this.brain.outline(projectId, path);
    } catch (error) {
      if (error instanceof ConflictException) return placements;
      throw error;
    }
    const context = await this.documents.context(projectId);
    const text = await this.documents.readText(context, outline.commit, path, PAGE_MAX_BYTES);
    if (text === undefined) return placements;
    // The page path names what comes before the first heading.
    const sections = [...outline.sections, { anchor: path, lineStart: 1, lineEnd: text.split("\n").length }];
    // The page is read once for all of its comments: a page may have a hundred.
    const found = reanchorAll(text, inline.map((row) => row.anchor!), sections);
    inline.forEach((row, at) => {
      const place = found[at]!;
      if (place.status === "orphaned") placements.set(row.id, { status: "orphaned", line: null });
      else placements.set(row.id, { status: place.status, line: place.line, node: sectionAt(sections, place.line, path) });
    });
    return placements;
  }

  /**
   * Tells the people a comment concerns, each once: those it mentions (`wiki-mention`), the author of the comment it answers
   * and the people who watch the page, its folders or its space (`wiki-comment`). Never the author of the comment, and only
   * people who still have Project Access; a name that is nobody's is not found and costs no notification.
   */
  async #notify(projectId: string, actor: Actor, pageKey: string, path: string, comment: WikiCommentRow, parentAuthorId: string | undefined): Promise<void> {
    const mentioned = await this.people.mentionedIds(projectId, comment.body);
    const folders = path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    const space = await this.brain.lookup(projectId, path).then(
      (found) => found.matches.find((match) => match.kind === "document")?.space ?? null,
      () => null,
    );
    const watchers = await this.watches.watchersOf(projectId, [
      { scopeKind: "page", target: pageKey },
      { scopeKind: "page", target: `path:${path}` },
      ...folders.map((target) => ({ scopeKind: "folder" as const, target })),
      ...(space === null ? [] : [{ scopeKind: "space" as const, target: space.toUpperCase() }]),
    ]);
    // One notification a person, the strongest reason first: a mention, then an answer or a watch.
    const kinds = new Map<string, "wiki-mention" | "wiki-comment">();
    for (const id of [...(parentAuthorId === undefined ? [] : [parentAuthorId]), ...watchers.slice(0, NOTIFY_MAX)]) kinds.set(id, "wiki-comment");
    for (const id of mentioned) kinds.set(id, "wiki-mention");
    kinds.delete(actor.id);
    for (const [userId, kind] of kinds) {
      // A person who lost Project Access (a watcher from before) hears nothing.
      if (!(await this.projectAccess.requireRead(userId, projectId).then(() => true, () => false))) continue;
      await this.notifications.create({ userId, projectId, kind, subject: { pageKey, commentId: comment.id, actorId: actor.id }, dedupeKey: `${kind}:${userId}:${comment.id}:-` });
    }
  }

  /** The page at the head of the default branch: its key (its id, else its path) and that it exists; 404 when it does not. */
  async #page(projectId: string, path: string): Promise<{ key: string }> {
    if (!path.toLowerCase().endsWith(".md")) throw new BadRequestException(`${path} is not a page`);
    const context = await this.documents.context(projectId);
    const { defaultTip } = await this.documents.branchTips(context);
    const page = defaultTip === undefined ? undefined : await this.documents.readPage(context, defaultTip.commit, path, PAGE_MAX_BYTES);
    if (page === undefined) throw new NotFoundException(`${path} does not exist on the default branch`);
    return { key: pageIdOf(page.text) ?? `path:${path}` };
  }

  /** The anchor to store: the section and the passage checked against the page as the Brain indexed it, and the commit. */
  async #place(projectId: string, path: string, given: NonNullable<CommentInput["anchor"]>): Promise<{ anchor: WikiCommentAnchor; line: number | null }> {
    // The heading anchor or card id, or the page path for a passage before the first heading; the node id of the Brain is accepted too.
    const node = given.node.startsWith(`${path}#`) ? given.node.slice(path.length + 1) : given.node;
    const { commit, sections } = await this.brain.outline(projectId, path);
    if (node !== path && !sections.some((section) => section.anchor === node)) throw new BadRequestException(`${given.node} is not a heading or a card of ${path}`);
    const context = await this.documents.context(projectId);
    const text = await this.documents.readText(context, commit, path, PAGE_MAX_BYTES);
    if (text === undefined) throw new BadRequestException(`${path} is not in the index yet: comment on the whole page, or try again in a moment`);
    const anchor = { node, exact: given.exact, prefix: given.prefix ?? "", suffix: given.suffix ?? "" };
    const found = reanchor(text, anchor, [...sections, { anchor: path, lineStart: 1, lineEnd: text.split("\n").length }]);
    if (found.status === "orphaned") throw new BadRequestException("That passage is not in the page as it was last indexed; select it again");
    return { anchor: { ...anchor, commit }, line: found.line };
  }
}

const gone = (id: string): NotFoundException => new NotFoundException(`There is no comment ${id.slice(0, 64)}`);
const tooMany = (): ConflictException => new ConflictException({ message: `This page already has ${COMMENTS_OPEN_MAX} open comments; resolve some before adding more`, details: { code: "too-many", limit: COMMENTS_OPEN_MAX } });

/** Where a comment's passage is now. */
interface Placement {
  status: WikiCommentView["status"];
  line: number | null;
  /** The heading or card it is under now, when that is not the one it was written under. */
  node?: string;
}

/** The section whose own lines hold the line, the narrowest one; the page path (what comes before the first heading) when none does. */
function sectionAt(sections: ReadonlyArray<{ anchor: string; lineStart: number; lineEnd: number }>, line: number, path: string): string {
  let best: { anchor: string; size: number } | undefined;
  for (const section of sections) {
    if (section.anchor === path || section.lineStart > line || section.lineEnd < line) continue;
    const size = section.lineEnd - section.lineStart;
    if (best === undefined || size < best.size) best = { anchor: section.anchor, size };
  }
  return best?.anchor ?? path;
}

/** A comment as the panel reads it; where a passage is now is `placement`, the passage as it was written otherwise. */
export function toView(row: WikiCommentRow, placement?: Placement): WikiCommentView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    parentId: row.parentId,
    author: row.author,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    resolved: row.status === "resolved",
    deleted,
    node: row.anchor === null ? null : (placement?.node ?? row.anchor.node),
    status: row.anchor === null ? "anchored" : (placement?.status ?? "anchored"),
    line: row.anchor === null ? null : (placement?.line ?? null),
    quote: row.anchor === null ? null : row.anchor.exact,
  };
}
