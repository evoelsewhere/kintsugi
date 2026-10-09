import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateIncidentInput, UpdateIncidentInput, Incident } from "./incident.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class IncidentsService {
  readonly #items = new Map<string, Incident>();

  async list(): Promise<Incident[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Incident> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Incident ${id} not found`);
    return item;
  }
  async create(input: CreateIncidentInput): Promise<Incident> {
    const item: Incident = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateIncidentInput): Promise<Incident> {
    const item = await this.get(id);
    const updated: Incident = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
