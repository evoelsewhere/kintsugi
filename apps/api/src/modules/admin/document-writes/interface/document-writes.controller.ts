// Interface layer: document writes of a project (ADR-0019). Publishing needs projects.manage;
// the list needs a session, like the project itself.

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { DocumentWritesService } from "../application/document-writes.service.js";
import type { DocumentWriteRecord } from "../domain/document-write.js";
import { type PublishManifestInput, publishManifestSchema } from "./document-write.dto.js";

@ApiTags("admin · projects & applications")
@Controller("admin/projects")
export class DocumentWritesController {
  constructor(private readonly writes: DocumentWritesService) {}

  @RequirePermission("projects.manage")
  @Post(":id/kintsugi.yaml/publish")
  @HttpCode(202)
  @ApiOperation({ summary: "Publish the rendered kintsugi.yaml, with the starter structure for what is missing (body { scaffold: false } for the manifest alone), to the document repo (queued; the worker opens one pull request)" })
  @ApiAcceptedResponse({ description: "The queued document write." })
  publish(@Param("id") id: string, @CurrentActor() actor: Actor, @Body({ schema: publishManifestSchema }) input: PublishManifestInput): Promise<DocumentWriteRecord> {
    return this.writes.publishManifest(id, actor, input);
  }

  @Get(":id/document-writes")
  @ApiOperation({ summary: "List the project's document writes, newest first: status, branch, commit and pull request" })
  @ApiOkResponse({ description: "A page of document writes." })
  list(@Param("id") id: string, @Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<DocumentWriteRecord>> {
    return this.writes.list(id, query);
  }
}
