import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateReviewInput, UpdateReviewInput, Review } from "./review.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class ReviewsService {
  readonly #items = new Map<string, Review>();

  async list(): Promise<Review[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Review> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Review ${id} not found`);
    return item;
  }
  async create(input: CreateReviewInput): Promise<Review> {
    const item: Review = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateReviewInput): Promise<Review> {
    const item = await this.get(id);
    const updated: Review = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
