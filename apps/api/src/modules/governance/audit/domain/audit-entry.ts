// Domain of AuditEntries: entity and commands. Pure types — no framework, no I/O.

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  status?: string;
}

export interface CreateAuditEntry {
  actor: string;
  action: string;
  status?: string;
}
