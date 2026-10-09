import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCutoverChecklistInput, UpdateCutoverChecklistInput, CutoverChecklist } from "./cutover-checklist.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class CutoverChecklistsService {
  readonly #items = new Map<string, CutoverChecklist>();

  async list(): Promise<CutoverChecklist[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<CutoverChecklist> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`CutoverChecklist ${id} not found`);
    return item;
  }
  async create(input: CreateCutoverChecklistInput): Promise<CutoverChecklist> {
    const item: CutoverChecklist = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateCutoverChecklistInput): Promise<CutoverChecklist> {
    const item = await this.get(id);
    const updated: CutoverChecklist = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
