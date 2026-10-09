import { Injectable, NotFoundException } from "@nestjs/common";
import type { DashboardStat } from "./dashboard-stat.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class DashboardStatsService {
  readonly #items = new Map<string, DashboardStat>();

  async list(): Promise<DashboardStat[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<DashboardStat> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`DashboardStat ${id} not found`);
    return item;
  }
}
