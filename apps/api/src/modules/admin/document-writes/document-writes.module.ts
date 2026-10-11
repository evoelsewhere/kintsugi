// Wiring of the document writes module: the use cases plus the Postgres store and the
// pg-boss queue bound to the domain ports. Projects come from the projects module.

import { Module } from "@nestjs/common";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { DocumentWritesService } from "./application/document-writes.service.js";
import { DocumentWriteQueue, DocumentWriteStore } from "./domain/document-write.ports.js";
import { PgBossDocumentWriteQueue } from "./infrastructure/pg-boss-document-write.queue.js";
import { PgDocumentWriteStore } from "./infrastructure/pg-document-write.store.js";
import { DocumentWritesController } from "./interface/document-writes.controller.js";

/** admin · document repo writes (A1 + E6, ADR-0019): the API records and enqueues, the worker commits. */
@Module({
  imports: [ProjectsModule],
  controllers: [DocumentWritesController],
  providers: [
    DocumentWritesService,
    { provide: DocumentWriteStore, useClass: PgDocumentWriteStore },
    { provide: DocumentWriteQueue, useClass: PgBossDocumentWriteQueue },
  ],
  exports: [DocumentWritesService],
})
export class DocumentWritesModule {}
