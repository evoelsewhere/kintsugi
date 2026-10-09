// Application layer: use cases for roles & permissions (Roles & Permissions UI).

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateSubRole, PermissionRecord, RoleRecord } from "../domain/role.js";
import { RoleRepository } from "../domain/role.repository.js";

@Injectable()
export class RolesService {
  constructor(private readonly roles: RoleRepository) {}

  list(): Promise<RoleRecord[]> {
    return this.roles.list();
  }

  async get(id: string): Promise<RoleRecord> {
    const role = await this.roles.get(id);
    if (role === undefined) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async createSubRole(input: CreateSubRole): Promise<RoleRecord> {
    const existing = await this.roles.get(input.id);
    if (existing !== undefined) throw new ConflictException(`Role ${input.id} already exists`);
    return this.roles.createSubRole(input);
  }

  async removeSubRole(id: string): Promise<void> {
    const role = await this.get(id);
    if (role.kind !== "sub") throw new ConflictException(`Primary role ${id} cannot be removed`);
    await this.roles.removeSubRole(id);
  }

  async setPermissions(roleId: string, codes: string[]): Promise<RoleRecord> {
    const role = await this.get(roleId);
    const catalog = new Set((await this.roles.listPermissions()).map((permission) => permission.code));
    const unknown = codes.filter((code) => !catalog.has(code));
    if (unknown.length > 0) throw new BadRequestException(`Unknown permission codes: ${unknown.join(", ")}`);
    const updated = await this.roles.setPermissions(role.id, codes);
    if (updated === undefined) throw new NotFoundException(`Role ${roleId} not found`);
    return updated;
  }

  /** The dynamic permission catalog (core.permission rows, added via migrations). */
  listPermissions(): Promise<PermissionRecord[]> {
    return this.roles.listPermissions();
  }

  /** Effective permissions of a user — used by the auth guard and /auth/me. */
  permissionsOfUser(userId: string): Promise<string[]> {
    return this.roles.permissionsOfUser(userId);
  }
}
