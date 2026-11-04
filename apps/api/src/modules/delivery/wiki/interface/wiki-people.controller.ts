// The directory a comment's editor suggests mentions from (COL-08): people with Project Access on the project, by name,
// without email addresses. Every route needs Project Access on the project, as every project route.

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiPeopleService } from "../application/wiki-people.service.js";
import type { WikiPerson } from "../domain/wiki.ports.js";
import { type PeopleQuery, peopleQuerySchema } from "./wiki-people.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiPeopleController {
  constructor(private readonly people: WikiPeopleService) {}

  @Get("people")
  @ApiOperation({ summary: "People with Project Access whose name holds the text (at most 20), for mentions; no email address" })
  search(@Param("id") id: string, @Query({ schema: peopleQuerySchema }) query: PeopleQuery): Promise<WikiPerson[]> {
    return this.people.search(id, query.q);
  }
}
