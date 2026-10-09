import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkItem } from "./work-item.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class WorkItemsService {
  readonly #items = new Map<string, WorkItem>();

  async list(): Promise<WorkItem[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<WorkItem> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`WorkItem ${id} not found`);
    return item;
  }
  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const item: WorkItem = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateWorkItemInput): Promise<WorkItem> {
    const item = await this.get(id);
    const updated: WorkItem = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
