// Port of the audit log — the DI token of this module. Append-only: there is no update or
// delete (the Postgres table refuses both).

import type { AuditEntry, AuditQuery, NewAuditEntry } from "./audit-entry.js";
import type { PoolClient } from "pg";

export abstract class AuditLog {
  /** Appends entries in one transaction: all of them or none. */
  abstract append(entries: readonly NewAuditEntry[]): Promise<void>;
  /** Appends atomically and returns durable IDs in input order. */
  abstract appendWithIds(entries: readonly NewAuditEntry[], client?: PoolClient): Promise<string[]>;
  /** Newest first, with the total. */
  abstract list(query: AuditQuery): Promise<{ items: AuditEntry[]; total: number }>;
  abstract get(id: string): Promise<AuditEntry | undefined>;
}
