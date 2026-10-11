// Public surface of the audit module: other modules import only from here.

export { AuditEntriesModule } from "./audit-entries.module.js";
export { AuditService } from "./application/audit.service.js";
export { AUDIT_ACTIONS, type AuditEntry, type NewAuditEntry } from "./domain/audit-entry.js";
