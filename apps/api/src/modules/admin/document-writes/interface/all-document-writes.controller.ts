// Interface layer: document writes across projects (activity and pull-request views),
// read-only. A session is enough, and the list shows the writes of the projects the caller holds Project Access on
// (ADR-0099 decision 4).

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { DocumentWritesService } from "../application/document-writes.service.js";
import type { DocumentWriteRecord } from "../domain/document-write.js";
import { type ListAllDocumentWritesQuery, listAllDocumentWritesQuerySchema } from "./document-write.dto.js";

@ApiTags("admin · projects & applications")
@Controller("document-writes")
export class AllDocumentWritesController {
  constructor(
    private readonly writes: DocumentWritesService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List document writes across projects, newest first (filter by status list and project)" })
  @ApiOkResponse({ description: "A page of document writes." })
  async list(@Query({ schema: listAllDocumentWritesQuerySchema }) query: ListAllDocumentWritesQuery, @CurrentActor() actor: Actor): Promise<Page<DocumentWriteRecord>> {
    return this.writes.listAll(
      {
        projectIds: await this.access.readableProjectIds(actor.id),
        ...(query.status === undefined ? {} : { statuses: query.status }),
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }
}
