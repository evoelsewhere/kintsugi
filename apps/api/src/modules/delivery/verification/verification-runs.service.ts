import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateVerificationRunInput, UpdateVerificationRunInput, VerificationRun } from "./verification-run.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class VerificationRunsService {
  readonly #items = new Map<string, VerificationRun>();

  async list(): Promise<VerificationRun[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<VerificationRun> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`VerificationRun ${id} not found`);
    return item;
  }
  async create(input: CreateVerificationRunInput): Promise<VerificationRun> {
    const item: VerificationRun = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateVerificationRunInput): Promise<VerificationRun> {
    const item = await this.get(id);
    const updated: VerificationRun = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
