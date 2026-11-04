// Edit restrictions (ADR-0099 decision 5): anyone with Project Access may read the ones that cover a page, to understand
// a refusal; changing them needs `wiki.manage` as well.

import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiRestrictionService } from "../application/wiki-restriction.service.js";
import type { WikiRestrictionView } from "../domain/wiki.js";
import { type ClearRestrictionQuery, type RestrictionsQuery, type SetRestrictionBody, clearRestrictionQuerySchema, restrictionsQuerySchema, setRestrictionSchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki/restrictions")
@UseGuards(ProjectAccessGuard)
export class WikiRestrictionController {
  constructor(private readonly restrictions: WikiRestrictionService) {}

  @Get()
  @ApiOperation({ summary: "The restrictions that cover a page (all of the project's without ?path): who is let in under each prefix, for editing or publishing" })
  list(@Param("id") id: string, @Query({ schema: restrictionsQuerySchema }) query: RestrictionsQuery): Promise<WikiRestrictionView[]> {
    return this.restrictions.list(id, query.path);
  }

  @Put()
  @RequirePermission("wiki.manage")
  @ApiOperation({
    summary: "Limit editing or publishing under a prefix to the listed people and roles (replaces what the prefix and kind had)",
    description: "A restriction only narrows: a rule on a page adds to the rule of its folder, and holding wiki.manage exempts nobody.",
  })
  set(@Param("id") id: string, @Body({ schema: setRestrictionSchema }) body: SetRestrictionBody, @CurrentActor() actor: Actor): Promise<WikiRestrictionView> {
    return this.restrictions.set(id, actor, body);
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission("wiki.manage")
  @ApiOperation({ summary: "Remove the restriction of a prefix and kind (404 when there is none)" })
  async clear(@Param("id") id: string, @Query({ schema: clearRestrictionQuerySchema }) query: ClearRestrictionQuery, @CurrentActor() actor: Actor): Promise<void> {
    await this.restrictions.clear(id, actor, query.pathPrefix, query.kind);
  }
}
