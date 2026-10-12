// Interface layer: the item catalog of an application with the derived status of every item
// (ADR-0033). Reading needs a session, like the documents it comes from.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CatalogService } from "../application/catalog.service.js";
import type { CatalogView } from "../domain/catalog.js";
import { type CatalogQuery, catalogQuerySchema } from "./catalog.dto.js";

@ApiTags("delivery · item catalog")
@Controller("projects/:id/applications/:appId")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("catalog")
  @ApiOperation({
    summary: "The item catalog of an application (assessment/<app>/catalog.json) with a derived status per item",
    description: "Status by precedence: running > in-pr > failed > stale > understood > not-analysed; retired beside them. Default ref: the default branch.",
  })
  @ApiOkResponse({ description: "The catalog (modules, unassigned files, ambiguities), its items with status, last run, pull request and understood state, and counts per status." })
  get(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: catalogQuerySchema }) query: CatalogQuery): Promise<CatalogView> {
    return this.catalog.view(id, appId, query.ref);
  }
}
