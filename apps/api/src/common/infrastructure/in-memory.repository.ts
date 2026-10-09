// Shared infrastructure kernel: in-memory repository adapter for development
// skeletons. Replace it with the Postgres adapter when the module's data lands —
// one schema per domain (see common/db/pool.ts); admin/llm-providers shows the pattern.

import type { Entity } from "../domain/repository.js";
import { Repository } from "../domain/repository.js";

export class InMemoryRepository<T extends Entity, C> extends Repository<T, C> {
  readonly #items = new Map<string, T>();

  constructor(private readonly factory: (input: C) => T) {
    super();
  }

  async list(): Promise<T[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<T | undefined> {
    return this.#items.get(id);
  }

  async create(input: C): Promise<T> {
    const item = this.factory(input);
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: Partial<C>): Promise<T | undefined> {
    const item = this.#items.get(id);
    if (item === undefined) return undefined;
    const updated = { ...item, ...input } as T;
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.#items.delete(id);
  }
}
