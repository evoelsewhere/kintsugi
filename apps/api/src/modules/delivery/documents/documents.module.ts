// Wiring of the documents module: read-only document repo access over the mirror (git CLI)
// and the stage results built from it. Projects, runs and writes come from their modules.

import { Module } from "@nestjs/common";
import { DocumentWritesModule } from "#modules/admin/document-writes/index.js";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { RuntimeJobsModule } from "#modules/delivery/runtime-jobs/index.js";
import { DocumentsService } from "./application/documents.service.js";
import { StageResultsService } from "./application/stage-results.service.js";
import { DocumentRepoReader } from "./domain/document.ports.js";
import { GitMirrorDocumentReader } from "./infrastructure/git-mirror.reader.js";
import { DocumentsController } from "./interface/documents.controller.js";

/** delivery · documents (ADR-0025, ADR-0028): the document repo as the mirror holds it, and stage results. */
@Module({
  imports: [ProjectsModule, RuntimeJobsModule, DocumentWritesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, StageResultsService, { provide: DocumentRepoReader, useClass: GitMirrorDocumentReader }],
  exports: [DocumentsService, StageResultsService],
})
export class DocumentsModule {}
