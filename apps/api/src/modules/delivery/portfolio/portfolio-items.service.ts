import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePortfolioItemInput, UpdatePortfolioItemInput, PortfolioItem } from "./portfolio-item.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class PortfolioItemsService {
  readonly #items = new Map<string, PortfolioItem>();

  async list(): Promise<PortfolioItem[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<PortfolioItem> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`PortfolioItem ${id} not found`);
    return item;
  }
  async create(input: CreatePortfolioItemInput): Promise<PortfolioItem> {
    const item: PortfolioItem = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdatePortfolioItemInput): Promise<PortfolioItem> {
    const item = await this.get(id);
    const updated: PortfolioItem = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
