import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProjectBuildInput, UpdateProjectBuildInput, ProjectBuild } from "./project-build.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class ProjectBuildsService {
  readonly #items = new Map<string, ProjectBuild>();

  async list(): Promise<ProjectBuild[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<ProjectBuild> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`ProjectBuild ${id} not found`);
    return item;
  }
  async create(input: CreateProjectBuildInput): Promise<ProjectBuild> {
    const item: ProjectBuild = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateProjectBuildInput): Promise<ProjectBuild> {
    const item = await this.get(id);
    const updated: ProjectBuild = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
