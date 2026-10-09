// Application layer: use cases for members (Admin · Identity & Access, A2).

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { RolesService } from "../../roles/application/roles.service.js";
import { newId } from "../../../../common/domain/ids.js";
import { hashPassword, verifyPassword } from "../../../../common/security/password.js";
import type { CreateUser, UpdateUser, UserRecord } from "../domain/user.js";
import { UserRepository } from "../domain/user.repository.js";

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RolesService,
  ) {}

  list(): Promise<UserRecord[]> {
    return this.users.list();
  }

  async get(id: string): Promise<UserRecord> {
    const user = await this.users.get(id);
    if (user === undefined) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(input: CreateUser): Promise<UserRecord> {
    const existing = await this.users.findByUsername(input.username);
    if (existing !== undefined) throw new ConflictException(`Username ${input.username} already exists`);
    await this.#assertRolesExist(input.roleIds ?? []);
    return this.users.create(newId(), input, hashPassword(input.password));
  }

  async update(id: string, input: UpdateUser): Promise<UserRecord> {
    if (input.roleIds !== undefined) await this.#assertRolesExist(input.roleIds);
    const updated = await this.users.update(id, input);
    if (updated === undefined) throw new NotFoundException(`User ${id} not found`);
    return updated;
  }

  /** Rejects unknown role ids with 404 instead of a database FK violation. */
  async #assertRolesExist(roleIds: string[]): Promise<void> {
    for (const roleId of roleIds) {
      await this.roles.get(roleId);
    }
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.get(id);
    await this.users.setPassword(id, hashPassword(password));
  }

  async remove(id: string): Promise<void> {
    if (!(await this.users.remove(id))) throw new NotFoundException(`User ${id} not found`);
  }

  /** Credential check for sign-in (ADR-0008). Returns undefined on any failure. */
  async validateCredentials(username: string, password: string): Promise<UserRecord | undefined> {
    const user = await this.users.findByUsername(username);
    if (user === undefined || !user.enabled) return undefined;
    const stored = await this.users.passwordOf(user.id);
    if (stored === undefined || !verifyPassword(password, stored)) return undefined;
    return user;
  }

  count(): Promise<number> {
    return this.users.count();
  }
}
