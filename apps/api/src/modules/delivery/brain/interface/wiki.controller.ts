// The wiki switch of a project (ADR-0097 decision 5): turning it on turns the Brain on for the default branch and keeps
// it there. Project Access on the project, as every project route (ADR-0099 decision 4), plus `wiki.manage`.

import { Body, Controller, Param, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BrainStatusView } from "@kintsugi/domain";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { BrainService } from "../application/brain.service.js";
import { type WikiSwitchBody, wikiSwitchSchema } from "./brain.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiController {
  constructor(private readonly brain: BrainService) {}

  @Put()
  @RequirePermission("wiki.manage")
  @ApiOperation({ summary: "Turn the project's wiki on (its Brain follows the default branch) or off" })
  switch(@Param("id") id: string, @Body({ schema: wikiSwitchSchema }) body: WikiSwitchBody, @CurrentActor() actor: Actor): Promise<BrainStatusView> {
    return this.brain.setWiki(id, body.enabled, actor);
  }
}
