// New wiki pages (ADR-0096 decisions 3 and 4, ADR-0098): the draft of a new page, with its id and the text of a template,
// and the templates a folder offers. Every route needs Project Access on the project; making a page also needs `wiki.write`
// and a pass of the restrictions on its path, which the service checks and audits.

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { type WikiTemplateOption, WikiPageService } from "../application/wiki-page.service.js";
import type { WikiDraftView } from "../domain/wiki.js";
import { type NewPageBody, type TemplatesQuery, newPageSchema, templatesQuerySchema } from "./wiki-page.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiPageController {
  constructor(private readonly pages: WikiPageService) {}

  @Post("pages")
  @HttpCode(200)
  @ApiOperation({
    summary: "Start a new page: the caller's draft of it, with its id and the text of the template chosen",
    description: "The address is made from the title (`<folder>/<slug>.md`, `-2`, `-3` while taken). Nothing is sent to the writer: the draft is published as any other.",
  })
  create(@Param("id") id: string, @Body({ schema: newPageSchema }) body: NewPageBody, @CurrentActor() actor: Actor): Promise<WikiDraftView> {
    return this.pages.create(id, actor, body);
  }

  @Get("templates")
  @ApiOperation({ summary: "The templates a new page of a folder may start from: its space's and the system ones, read-only" })
  templates(@Param("id") id: string, @Query({ schema: templatesQuerySchema }) query: TemplatesQuery): Promise<WikiTemplateOption[]> {
    return this.pages.templates(id, query.folder);
  }
}
