// Comments on wiki pages (ADR-0099 decision 1): reading needs Project Access, writing also `wiki.comment`, which the service checks.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiCommentService } from "../application/wiki-comment.service.js";
import type { WikiCommentList, WikiCommentView } from "../domain/wiki.comment.js";
import { type CommentsQuery, type PatchCommentBody, type PostCommentBody, commentsQuerySchema, patchCommentSchema, postCommentSchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki/comments")
@UseGuards(ProjectAccessGuard)
export class WikiCommentController {
  constructor(private readonly comments: WikiCommentService) {}

  @Get()
  @ApiOperation({
    summary: "The comments of a page in time order, each with its author, its resolved and deleted state, the heading it is under and its quote",
    description: "limit is at most 100; pass the answer's next as after for the following page. A deleted comment is listed, blank, only while an answer to it is.",
  })
  list(@Param("id") id: string, @Query({ schema: commentsQuerySchema }) query: CommentsQuery): Promise<WikiCommentList> {
    return this.comments.list(id, query.path, query.limit, query.after);
  }

  @Post()
  @ApiOperation({
    summary: "Comment on a page, on a passage of it, or answer a comment",
    description:
      "Needs wiki.comment. An inline comment sends anchor { node, exact, prefix?, suffix? }: the heading anchor or card id it is under (the page path before the first heading) and the selected plain text; the server checks it against the page as the Brain indexed it and records that commit. 409 details.code too-many over 200 open comments on the page.",
  })
  post(@Param("id") id: string, @Body({ schema: postCommentSchema }) body: PostCommentBody, @CurrentActor() actor: Actor): Promise<WikiCommentView> {
    return this.comments.create(id, actor, body);
  }

  @Patch(":commentId")
  @ApiOperation({
    summary: "Resolve or reopen a comment, or edit its text",
    description: "Needs wiki.comment. Anyone who holds it may resolve or reopen a comment that is not an answer; only the author edits the text. Reopening is refused (409 too-many) when the page already has 200 open comments.",
  })
  update(@Param("id") id: string, @Param("commentId") commentId: string, @Body({ schema: patchCommentSchema }) body: PatchCommentBody, @CurrentActor() actor: Actor): Promise<WikiCommentView> {
    return this.comments.update(id, actor, commentId, body);
  }

  @Delete(":commentId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a comment",
    description: "The author may delete a comment that has no answers; someone with wiki.manage may delete any comment, which is then audited as wiki-comment.delete (path, comment and author, never the text). A deleted comment that has answers stays as an empty marker.",
  })
  async remove(@Param("id") id: string, @Param("commentId") commentId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.comments.remove(id, actor, commentId);
  }
}
