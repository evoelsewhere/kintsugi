// Application layer: the audit log. Implements the shared kernel's AuditTrail port, so other
// modules record through `AuditTrail` without importing this module: record() is fail-closed
// (when the entry cannot be written, the audited action does not happen), recordChange() is for
// changes that already happened and never throws. Holders of audit.read list it.

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { type AuditRecord, AuditTrail } from "#common/audit/audit-trail.js";
import { type Page, toPage } from "#common/application/pagination.js";
import { AUDIT_ACTION_LIST, type AuditEntry, type AuditQuery } from "../domain/audit-entry.js";
import { AuditLog } from "../domain/audit-log.port.js";

@Injectable()
export class AuditService extends AuditTrail {
  readonly #logger = new Logger("Audit");

  constructor(private readonly log: AuditLog) {
    super();
  }

  /** Appends the entries (all or none); throws when they cannot be stored. */
  async record(entries: readonly AuditRecord[]): Promise<void> {
    await this.log.append(entries);
  }

  async recordWithIds(entries: readonly AuditRecord[], client?: PoolClient): Promise<string[]> {
    return this.log.appendWithIds(entries, client);
  }

  async recordChange(entry: AuditRecord): Promise<void> {
    try {
      await this.log.append([entry]);
    } catch (error) {
      this.#logger.error(`could not record ${entry.action} on ${entry.subject ?? "-"} by ${entry.actor}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async list(query: AuditQuery): Promise<Page<AuditEntry>> {
    const { items, total } = await this.log.list(query);
    return toPage(items, total, query);
  }

  async get(id: string): Promise<AuditEntry> {
    const entry = await this.log.get(id);
    if (entry === undefined) throw new NotFoundException(`Audit entry ${id} not found`);
    return entry;
  }

  /** The actions the API records, for the audit log's filters. */
  actions(): readonly string[] {
    return AUDIT_ACTION_LIST;
  }
}
