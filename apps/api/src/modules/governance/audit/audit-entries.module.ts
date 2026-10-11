// Wiring of the audit module: the use cases plus the Postgres audit log bound to the port.

import { Module } from "@nestjs/common";
import { AuditService } from "./application/audit.service.js";
import { AuditLog } from "./domain/audit-log.port.js";
import { PgAuditLog } from "./infrastructure/pg-audit-log.js";
import { AuditEntriesController } from "./interface/audit-entries.controller.js";

/** governance · audit & traceability — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [AuditEntriesController],
  providers: [AuditService, { provide: AuditLog, useClass: PgAuditLog }],
  exports: [AuditService],
})
export class AuditEntriesModule {}
