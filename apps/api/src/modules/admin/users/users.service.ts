import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateUserInput, UpdateUserInput, User } from "./user.dto.js";

/**
 * In-memory stub. Replace the Map with the Postgres repository once the data layer lands;
 * keep the method signatures — controllers and tests depend on them.
 */
@Injectable()
export class UsersService {
  readonly #items = new Map<string, User>();

  async list(): Promise<User[]> {
    return [...this.#items.values()];
  }

  async get(id: string): Promise<User> {
    const item = this.#items.get(id);
    if (item === undefined) throw new NotFoundException(`User ${id} not found`);
    return item;
  }
  async create(input: CreateUserInput): Promise<User> {
    const item: User = { id: randomUUID(), ...input };
    this.#items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const item = await this.get(id);
    const updated: User = { ...item, ...input };
    this.#items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.#items.delete(id);
  }
}
