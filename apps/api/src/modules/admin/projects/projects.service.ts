import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProjectInput, UpdateProjectInput, Project } from "./project.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class ProjectsService {
  readonly #items = new Map<string, Project>();

  async list(): Promise<Project[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<Project> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`Project ${id} not found`);
    return item;
  }
  async create(input: CreateProjectInput): Promise<Project> {
    const item: Project = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const item = await this.get(id);
    const updated: Project = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
