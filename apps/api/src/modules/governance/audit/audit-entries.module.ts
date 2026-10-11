// Wiring of the audit module: the use cases plus the Postgres audit log bound to the port. The
// module is global so every feature module can inject the shared kernel's `AuditTrail` port
// (bound here to AuditService) without importing this module.

import { Global, Module } from "@nestjs/common";
import { AuditTrail } from "#common/audit/audit-trail.js";
import { AuditService } from "./application/audit.service.js";
import { AuditLog } from "./domain/audit-log.port.js";
import { PgAuditLog } from "./infrastructure/pg-audit-log.js";
import { AuditEntriesController } from "./interface/audit-entries.controller.js";

/** governance · audit & traceability — docs/architecture/05-building-block-view.md. */
@Global()
@Module({
  controllers: [AuditEntriesController],
  providers: [AuditService, { provide: AuditLog, useClass: PgAuditLog }, { provide: AuditTrail, useExisting: AuditService }],
  exports: [AuditService, AuditTrail],
})
export class AuditEntriesModule {}
