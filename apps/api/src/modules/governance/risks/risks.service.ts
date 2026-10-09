import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRiskInput, UpdateRiskInput, Risk } from "./risk.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class RisksService {
  readonly #items = new Map<string, Risk>();

  async list(): Promise<Risk[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Risk> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Risk ${id} not found`);
    return item;
  }
  async create(input: CreateRiskInput): Promise<Risk> {
    const item: Risk = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateRiskInput): Promise<Risk> {
    const item = await this.get(id);
    const updated: Risk = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
