import { Injectable, NotFoundException } from "@nestjs/common";
import type { Gate } from "./gate.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class GatesService {
  readonly #items = new Map<string, Gate>();

  async list(): Promise<Gate[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Gate> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Gate ${id} not found`);
    return item;
  }
}
