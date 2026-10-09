import { Injectable, NotFoundException } from "@nestjs/common";
import type { AiMetric } from "./ai-metric.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class AiMetricsService {
  readonly #items = new Map<string, AiMetric>();

  async list(): Promise<AiMetric[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<AiMetric> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`AiMetric ${id} not found`);
    return item;
  }
}
