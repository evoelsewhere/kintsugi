// Application layer: use cases of AuditEntries. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateAuditEntry, AuditEntry } from "../domain/audit-entry.js";
import { AuditEntryRepository } from "../domain/audit-entry.repository.js";

export type UpdateAuditEntry = Partial<CreateAuditEntry>;

@Injectable()
export class AuditEntriesService extends CrudService<AuditEntry, CreateAuditEntry> {
  constructor(items: AuditEntryRepository) {
    super(items, "AuditEntry");
  }
}
