// Interface layer: document writes across projects (activity and pull-request views),
// read-only. Needs a session, like the project-scoped list.

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { DocumentWritesService } from "../application/document-writes.service.js";
import type { DocumentWriteRecord } from "../domain/document-write.js";
import { type ListAllDocumentWritesQuery, listAllDocumentWritesQuerySchema } from "./document-write.dto.js";

@ApiTags("admin · projects & applications")
@Controller("document-writes")
export class AllDocumentWritesController {
  constructor(private readonly writes: DocumentWritesService) {}

  @Get()
  @ApiOperation({ summary: "List document writes across projects, newest first (filter by status list and project)" })
  @ApiOkResponse({ description: "A page of document writes." })
  list(@Query({ schema: listAllDocumentWritesQuerySchema }) query: ListAllDocumentWritesQuery): Promise<Page<DocumentWriteRecord>> {
    return this.writes.listAll(
      {
        ...(query.status === undefined ? {} : { statuses: query.status }),
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }
}
