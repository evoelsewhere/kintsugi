import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuditEntry } from "./audit-entry.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class AuditEntriesService {
  readonly #items = new Map<string, AuditEntry>();

  async list(): Promise<AuditEntry[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<AuditEntry> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`AuditEntry ${id} not found`);
    return item;
  }
}
