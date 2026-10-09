import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateFactorySetupInput, UpdateFactorySetupInput, FactorySetup } from "./factory-setup.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class FactorySetupsService {
  readonly #items = new Map<string, FactorySetup>();

  async list(): Promise<FactorySetup[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<FactorySetup> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`FactorySetup ${id} not found`);
    return item;
  }
  async create(input: CreateFactorySetupInput): Promise<FactorySetup> {
    const item: FactorySetup = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateFactorySetupInput): Promise<FactorySetup> {
    const item = await this.get(id);
    const updated: FactorySetup = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
