// Editing a wiki page (ADR-0098, ADR-0099): every route needs Project Access on the project, as every project route.

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiAccessService } from "../application/wiki-access.service.js";
import type { WikiAccess } from "../domain/wiki.js";
import { type WikiPathQuery, wikiPathQuerySchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiAccessController {
  constructor(private readonly access: WikiAccessService) {}

  @Get("access")
  @ApiOperation({
    summary: "What the caller may do to a page: editable, canWrite, canPublish, direct, the refusal and the write waiting for review",
    description: "The portal uses it to enable the Edit button and explain why not; the write routes check again.",
  })
  get(@Param("id") id: string, @Query({ schema: wikiPathQuerySchema }) query: WikiPathQuery, @CurrentActor() actor: Actor): Promise<WikiAccess> {
    return this.access.access(id, actor, query.path);
  }
}
