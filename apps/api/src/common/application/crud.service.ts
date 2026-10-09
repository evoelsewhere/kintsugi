// Shared application kernel: generic CRUD use cases over the repository port.
// Feature services extend it and add their own use cases on top.

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Entity } from "../domain/repository.js";
import { Repository } from "../domain/repository.js";
import type { Page, PageQuery } from "./pagination.js";
import { toPage } from "./pagination.js";

@Injectable()
export class CrudService<T extends Entity, C> {
  constructor(
    protected readonly items: Repository<T, C>,
    protected readonly label: string,
  ) {}

  list(): Promise<T[]> {
    return this.items.list();
  }

  /** Paginated listing. TODO: push limit/offset down into the Postgres adapters. */
  async listPage(query: PageQuery): Promise<Page<T>> {
    const items = await this.items.list();
    return toPage(items.slice(query.offset, query.offset + query.limit), items.length, query);
  }

  async get(id: string): Promise<T> {
    const item = await this.items.get(id);
    if (item === undefined) throw new NotFoundException(`${this.label} ${id} not found`);
    return item;
  }

  create(input: C): Promise<T> {
    return this.items.create(input);
  }

  async update(id: string, input: Partial<C>): Promise<T> {
    const updated = await this.items.update(id, input);
    if (updated === undefined) throw new NotFoundException(`${this.label} ${id} not found`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.items.remove(id))) throw new NotFoundException(`${this.label} ${id} not found`);
  }
}
