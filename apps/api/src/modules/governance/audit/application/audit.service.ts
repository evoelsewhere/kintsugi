// Application layer: the audit log. Other modules record through AuditService.record()
// (fail-closed: when the entry cannot be written, the audited action does not happen);
// holders of audit.read list it.

import { Injectable, NotFoundException } from "@nestjs/common";
import { type Page, toPage } from "#common/application/pagination.js";
import type { AuditEntry, AuditQuery, NewAuditEntry } from "../domain/audit-entry.js";
import { AuditLog } from "../domain/audit-log.port.js";

@Injectable()
export class AuditService {
  constructor(private readonly log: AuditLog) {}

  /** Appends the entries (all or none); throws when they cannot be stored. */
  async record(entries: readonly NewAuditEntry[]): Promise<void> {
    await this.log.append(entries);
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
}
