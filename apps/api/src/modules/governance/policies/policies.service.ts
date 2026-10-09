import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePolicyInput, UpdatePolicyInput, Policy } from "./policy.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class PoliciesService {
  readonly #items = new Map<string, Policy>();

  async list(): Promise<Policy[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Policy> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Policy ${id} not found`);
    return item;
  }
  async create(input: CreatePolicyInput): Promise<Policy> {
    const item: Policy = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdatePolicyInput): Promise<Policy> {
    const item = await this.get(id);
    const updated: Policy = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
