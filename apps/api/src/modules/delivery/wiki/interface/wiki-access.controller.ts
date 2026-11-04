// Editing a wiki page (ADR-0098, ADR-0099): every route needs Project Access on the project, as every project route.

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiAccessService } from "../application/wiki-access.service.js";
import type { WikiAccessPlaceholder } from "../domain/wiki.js";
import { type WikiPathQuery, wikiPathQuerySchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiAccessController {
  constructor(private readonly access: WikiAccessService) {}

  @Get("access")
  @ApiOperation({ summary: "What the caller may do to a page (a placeholder that grants nothing until the write rules land)" })
  get(@Param("id") id: string, @Query({ schema: wikiPathQuerySchema }) query: WikiPathQuery): WikiAccessPlaceholder {
    return this.access.access(id, query.path);
  }
}
