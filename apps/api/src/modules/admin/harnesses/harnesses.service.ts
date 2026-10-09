import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateHarnessInput, UpdateHarnessInput, Harness } from "./harness.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class HarnessesService {
  readonly #items = new Map<string, Harness>();

  async list(): Promise<Harness[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Harness> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Harness ${id} not found`);
    return item;
  }
  async create(input: CreateHarnessInput): Promise<Harness> {
    const item: Harness = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateHarnessInput): Promise<Harness> {
    const item = await this.get(id);
    const updated: Harness = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
