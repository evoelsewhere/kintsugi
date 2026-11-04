// Drafts of wiki pages (ADR-0098 decision 2): every route needs Project Access on the project, as every project route;
// saving and discarding also need `wiki.write`, which the service checks.

import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiDraftService } from "../application/wiki-draft.service.js";
import type { WikiDraftSummary, WikiDraftView } from "../domain/wiki.js";
import { type SaveDraftBody, type WikiPathQuery, saveDraftSchema, wikiPathQuerySchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiDraftController {
  constructor(private readonly drafts: WikiDraftService) {}

  @Get("draft")
  @ApiOperation({ summary: "The caller's draft of a page, with who else has touched the page in the last two minutes; 404 when there is none" })
  get(@Param("id") id: string, @Query({ schema: wikiPathQuerySchema }) query: WikiPathQuery, @CurrentActor() actor: Actor): Promise<WikiDraftView> {
    return this.drafts.get(id, actor, query.path);
  }

  @Put("draft")
  @ApiOperation({
    summary: "Save the caller's draft of a page (autosave: nothing is published)",
    description:
      "The first save has baseRevision null and, for a page that exists, baseCommit: the commit of the default branch the text was read from; the server hashes the page at that commit. Later saves name the stored revision; a stale one is a 409 with details.code draft-revision and details.revision.",
  })
  save(@Param("id") id: string, @Body({ schema: saveDraftSchema }) body: SaveDraftBody, @CurrentActor() actor: Actor): Promise<WikiDraftView> {
    return this.drafts.save(id, actor, body);
  }

  @Delete("draft")
  @HttpCode(204)
  @ApiOperation({ summary: "Discard the caller's draft of a page" })
  async discard(@Param("id") id: string, @Query({ schema: wikiPathQuerySchema }) query: WikiPathQuery, @CurrentActor() actor: Actor): Promise<void> {
    await this.drafts.discard(id, actor, query.path);
  }

  @Get("drafts")
  @ApiOperation({ summary: "The caller's drafts in the project, the newest touched first" })
  list(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<WikiDraftSummary[]> {
    return this.drafts.list(id, actor);
  }
}
