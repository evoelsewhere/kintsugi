// In-memory audit trail for unit tests: keeps every entry so tests can assert what was recorded.

import { type AuditRecord, AuditTrail } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";

export class MemoryAuditTrail extends AuditTrail {
  readonly entries: AuditRecord[] = [];

  async record(entries: readonly AuditRecord[]): Promise<void> {
    this.entries.push(...entries);
  }

  async recordChange(entry: AuditRecord): Promise<void> {
    this.entries.push(entry);
  }

  /** The recorded action names, in order. */
  actions(): string[] {
    return this.entries.map((entry) => entry.action);
  }
}

export const testAdmin: Actor = { id: "u-admin", username: "admin", permissions: [] };
