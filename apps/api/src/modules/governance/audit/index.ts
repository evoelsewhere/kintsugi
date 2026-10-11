// Public surface of the audit module: other modules import only from here (to record, inject
// the shared kernel's `AuditTrail` from #common/audit/audit-trail.js instead).

export { AuditEntriesModule } from "./audit-entries.module.js";
export { AuditService } from "./application/audit.service.js";
export { AUDIT_ACTIONS, AUDIT_ACTION_LIST, type AuditEntry, type NewAuditEntry } from "./domain/audit-entry.js";
