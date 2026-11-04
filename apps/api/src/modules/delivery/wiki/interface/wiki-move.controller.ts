// Moving and renaming a wiki page (ADR-0098 decision 5): a preview that writes nothing, and one write that moves the page
// and rewrites the links to it. Every route needs Project Access on the project; the move also needs `wiki.write` and a
// pass of the restrictions on every path it touches, which the service checks and audits.

import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiMoveService, type WikiMovePreview, type WikiMoveResult } from "../application/wiki-move.service.js";
import { type MoveBody, type MovePreviewBody, movePreviewSchema, moveSchema } from "./wiki-move.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiMoveController {
  constructor(private readonly moves: WikiMoveService) {}

  @Post("move/preview")
  @HttpCode(200)
  @ApiOperation({ summary: "What moving a page would change: the page and every page whose links to it are rewritten. Writes nothing" })
  preview(@Param("id") id: string, @Body({ schema: movePreviewSchema }) body: MovePreviewBody): Promise<WikiMovePreview> {
    return this.moves.preview(id, body);
  }

  @Post("move")
  @HttpCode(200)
  @ApiOperation({
    summary: "Move or rename a page and rewrite the links to it, as one write",
    description:
      "409 `target-exists`, `too-many` (more than 500 entries) or `open-write` (a page it would change has a write waiting for review); 403 for a path the caller may not write, audited.",
  })
  move(@Param("id") id: string, @Body({ schema: moveSchema }) body: MoveBody, @CurrentActor() actor: Actor): Promise<WikiMoveResult> {
    return this.moves.move(id, actor, body);
  }
}
