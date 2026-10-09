import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRulebookEntryInput, UpdateRulebookEntryInput, RulebookEntry } from "./rulebook-entry.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class RulebookEntriesService {
  readonly #items = new Map<string, RulebookEntry>();

  async list(): Promise<RulebookEntry[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<RulebookEntry> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`RulebookEntry ${id} not found`);
    return item;
  }
  async create(input: CreateRulebookEntryInput): Promise<RulebookEntry> {
    const item: RulebookEntry = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateRulebookEntryInput): Promise<RulebookEntry> {
    const item = await this.get(id);
    const updated: RulebookEntry = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
