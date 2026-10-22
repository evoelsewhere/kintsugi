// Interface layer: the item catalog of an application with the derived status of every item
// (ADR-0033). Reading needs a session, like the documents it comes from.

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { CatalogService } from "../application/catalog.service.js";
import { UnderstandRunsService } from "../application/understand-runs.service.js";
import type { CatalogView, UnderstandPlanView } from "../domain/catalog.js";
import { type CatalogQuery, type UnderstandRunBody, catalogQuerySchema, understandRunSchema } from "./catalog.dto.js";

@ApiTags("delivery · item catalog")
@Controller("projects/:id/applications/:appId")
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly understand: UnderstandRunsService,
  ) {}

  @Get("catalog")
  @ApiOperation({
    summary: "The application's item catalog with a status derived per catalog item",
    description: "Status by precedence: running > in-pr > failed > stale > understood > not-analysed; retired beside them. Default ref: the default branch.",
  })
  @ApiOkResponse({ description: "The catalog (modules, unassigned files, ambiguities), its items with status, last run, pull request and understood state, and counts per status." })
  get(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: catalogQuerySchema }) query: CatalogQuery): Promise<CatalogView> {
    return this.catalog.view(id, appId, query.ref);
  }

  @Get("understand/plan")
  @ApiOperation({
    summary: "The AI plan of what to understand next: batches of catalog items with a reason each (ADR-0041)",
    description: "Written by the plan-understand stage (POST …/stages/plan-understand/run) onto the default branch. `plan` is null before the first run; `stale` when the catalog was reassessed since.",
  })
  @ApiOkResponse({ description: "The plan (strategy, batches with size, cohesion and what each still depends on, what was left out or dropped), whether it is stale and the current status of its items." })
  plan(@Param("id") id: string, @Param("appId") appId: string): Promise<UnderstandPlanView> {
    return this.catalog.plan(id, appId);
  }

  @RequirePermission("jobs.run")
  @Post("understand/runs")
  @HttpCode(202)
  @ApiOperation({
    summary: "Run understand on a selection of catalog items (items and whole modules), or resume a failed run",
    description:
      "400 for unknown or retired ids; 409 when the catalog is not merged, or (with details.conflicts) when a selected item is running or in an open pull request; 422 above the items cap of a run.",
  })
  @ApiAcceptedResponse({ description: "The queued understand run." })
  run(@Param("id") id: string, @Param("appId") appId: string, @Body({ schema: understandRunSchema }) body: UnderstandRunBody, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.understand.start(id, appId, body, actor);
  }
}
