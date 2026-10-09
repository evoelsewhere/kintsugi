import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateLlmProviderInput, UpdateLlmProviderInput, LlmProvider } from "./llm-provider.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class LlmProvidersService {
  readonly #items = new Map<string, LlmProvider>();

  async list(): Promise<LlmProvider[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<LlmProvider> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`LlmProvider ${id} not found`);
    return item;
  }
  async create(input: CreateLlmProviderInput): Promise<LlmProvider> {
    const item: LlmProvider = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateLlmProviderInput): Promise<LlmProvider> {
    const item = await this.get(id);
    const updated: LlmProvider = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
