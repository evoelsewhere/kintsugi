import { Injectable, NotFoundException } from "@nestjs/common";
import type { HealthCheck } from "./health-check.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class HealthChecksService {
  readonly #items = new Map<string, HealthCheck>();

  async list(): Promise<HealthCheck[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<HealthCheck> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`HealthCheck ${id} not found`);
    return item;
  }
}
