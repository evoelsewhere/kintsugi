// Wiring of the audit-entries module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { AuditEntriesService } from "./application/audit-entries.service.js";
import { AuditEntryRepository } from "./domain/audit-entry.repository.js";
import { InMemoryAuditEntryRepository } from "./infrastructure/in-memory-audit-entry.repository.js";
import { AuditEntriesController } from "./interface/audit-entries.controller.js";

/** governance · audit & traceability — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [AuditEntriesController],
  providers: [AuditEntriesService, { provide: AuditEntryRepository, useClass: InMemoryAuditEntryRepository }],
  exports: [AuditEntriesService, AuditEntryRepository],
})
export class AuditEntriesModule {}
