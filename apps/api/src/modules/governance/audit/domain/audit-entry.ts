// Domain of the audit log (governance · audit & traceability): who did what, when, on which
// subject. Entries are append-only and never carry the content that was acted on (for a
// restricted-record read: the job run and the path, not the record). Pure types.

import type { AuditRecord } from "#common/audit/audit-trail.js";

export interface AuditEntry {
  id: string;
  at: string;
  /** User id of who acted. */
  actor: string;
  /** What happened, e.g. `restricted.read`. */
  action: string;
  projectId?: string;
  /** What was acted on, e.g. a job run id. */
  subject?: string;
  /** Small detail such as a path; never content. */
  detail: Record<string, unknown>;
}

/** An entry to append: the shared kernel's audit record. */
export type NewAuditEntry = AuditRecord;

export interface AuditQuery {
  /** Any of these actions. */
  actions?: string[];
  actor?: string;
  subject?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

/** Audit actions recorded by the API (the catalog lives in the shared kernel). */
export { AUDIT_ACTIONS, AUDIT_ACTION_LIST } from "#common/audit/audit-trail.js";
