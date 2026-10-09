import { Injectable, NotFoundException } from "@nestjs/common";
import type { CostEntry } from "./cost-entry.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class CostEntriesService {
  readonly #items = new Map<string, CostEntry>();

  async list(): Promise<CostEntry[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<CostEntry> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`CostEntry ${id} not found`);
    return item;
  }
}
