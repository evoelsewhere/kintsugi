import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateConnectorInput, UpdateConnectorInput, Connector } from "./connector.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class ConnectorsService {
  readonly #items = new Map<string, Connector>();

  async list(): Promise<Connector[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Connector> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Connector ${id} not found`);
    return item;
  }
  async create(input: CreateConnectorInput): Promise<Connector> {
    const item: Connector = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateConnectorInput): Promise<Connector> {
    const item = await this.get(id);
    const updated: Connector = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
