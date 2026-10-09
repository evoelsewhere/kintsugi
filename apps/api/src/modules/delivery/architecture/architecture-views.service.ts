import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateArchitectureViewInput, UpdateArchitectureViewInput, ArchitectureView } from "./architecture-view.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class ArchitectureViewsService {
  readonly #items = new Map<string, ArchitectureView>();

  async list(): Promise<ArchitectureView[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<ArchitectureView> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`ArchitectureView ${id} not found`);
    return item;
  }
  async create(input: CreateArchitectureViewInput): Promise<ArchitectureView> {
    const item: ArchitectureView = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateArchitectureViewInput): Promise<ArchitectureView> {
    const item = await this.get(id);
    const updated: ArchitectureView = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
