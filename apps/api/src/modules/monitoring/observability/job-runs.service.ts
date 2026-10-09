import { Injectable, NotFoundException } from "@nestjs/common";
import type { JobRun } from "./job-run.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class JobRunsService {
  readonly #items = new Map<string, JobRun>();

  async list(): Promise<JobRun[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<JobRun> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`JobRun ${id} not found`);
    return item;
  }
}
