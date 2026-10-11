// Port of the audit log — the DI token of this module. Append-only: there is no update or
// delete (the Postgres table refuses both).

import type { AuditEntry, AuditQuery, NewAuditEntry } from "./audit-entry.js";

export abstract class AuditLog {
  /** Appends entries in one transaction: all of them or none. */
  abstract append(entries: readonly NewAuditEntry[]): Promise<void>;
  /** Newest first, with the total. */
  abstract list(query: AuditQuery): Promise<{ items: AuditEntry[]; total: number }>;
  abstract get(id: string): Promise<AuditEntry | undefined>;
}
