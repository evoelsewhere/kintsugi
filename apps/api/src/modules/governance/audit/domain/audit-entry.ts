// Domain of the audit log (governance · audit & traceability): who did what, when, on which
// subject. Entries are append-only and never carry the content that was acted on (for a
// restricted-record read: the job run and the path, not the record). Pure types.

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

export interface NewAuditEntry {
  actor: string;
  action: string;
  projectId?: string;
  subject?: string;
  detail?: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  subject?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

/** Audit actions recorded by the API. */
export const AUDIT_ACTIONS = { restrictedRead: "restricted.read" } as const;
