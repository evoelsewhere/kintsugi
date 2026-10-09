import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTemplateInput, UpdateTemplateInput, Template } from "./template.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class TemplatesService {
  readonly #items = new Map<string, Template>();

  async list(): Promise<Template[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Template> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Template ${id} not found`);
    return item;
  }
  async create(input: CreateTemplateInput): Promise<Template> {
    const item: Template = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const item = await this.get(id);
    const updated: Template = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
