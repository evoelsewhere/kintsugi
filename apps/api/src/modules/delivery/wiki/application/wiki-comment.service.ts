// Comments on wiki pages (ADR-0099 decision 1): rows of the database that belong to a project and a page, anchored to a
// passage of it or to the page as a whole, never written to Git. A comment is made by a person with `wiki.comment`, read by
// anyone with Project Access. An inline comment keeps the passage (`exact`) and what surrounds it, taken from the page as
// the Brain indexed it, which the server checks and the client cannot choose.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { pageIdOf, reanchor } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { COMMENTS_OPEN_MAX, COMMENT_BODY_MAX, type WikiCommentAnchor, type WikiCommentList, type WikiCommentRow, type WikiCommentView } from "../domain/wiki.comment.js";
import { WikiComments } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";

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
  ) {}

  /** The comments of a page, in time order (`limit` of them after the comment `after`). */
  async list(projectId: string, path: string, limit: number, after: string | undefined): Promise<WikiCommentList> {
    const page = await this.#page(projectId, path);
    const found = await this.comments.listOfPage(projectId, page.key, limit, after);
    return { page: { key: page.key, path }, comments: found.rows.map((row) => toView(row)), next: found.next };
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
      throw new ConflictException({ message: `This page already has ${COMMENTS_OPEN_MAX} open comments; resolve some before adding more`, details: { code: "too-many", limit: COMMENTS_OPEN_MAX } });
    }
    return toView(result.comment, placed === undefined ? undefined : { line: placed.line });
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

/** A comment as the panel reads it; where a passage is now is `placement` (P3-003), the passage as it was written otherwise. */
export function toView(row: WikiCommentRow, placement?: { status?: WikiCommentView["status"]; line?: number | null }): WikiCommentView {
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
    node: row.anchor === null ? null : row.anchor.node,
    status: row.anchor === null ? "anchored" : (placement?.status ?? "anchored"),
    line: row.anchor === null ? null : (placement?.line ?? null),
    quote: row.anchor === null ? null : row.anchor.exact,
  };
}
