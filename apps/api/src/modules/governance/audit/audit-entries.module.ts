import { Module } from "@nestjs/common";
import { AuditEntriesController } from "./audit-entries.controller.js";
import { AuditEntriesService } from "./audit-entries.service.js";

/** governance · audit & traceability — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [AuditEntriesController], providers: [AuditEntriesService], exports: [AuditEntriesService] })
export class AuditEntriesModule {}
