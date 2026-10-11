// Application layer: use cases for installation access roles and permissions.

import { type Page, type PageQuery, toPage } from "#common/application/pagination.js";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { ADMIN_LOCKED_PERMISSIONS, ADMIN_ROLE_ID, type CreateSubRole, type PermissionRecord, type RoleRecord } from "../domain/role.js";
import { RoleRepository } from "../domain/role.repository.js";

export { ADMIN_ROLE_ID } from "../domain/role.js";

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditTrail,
  ) {}

  list(): Promise<RoleRecord[]> {
    return this.roles.list();
  }

  /** Access roles are few (primary access roles plus admin-defined access sub-roles): paginated in memory. */
  async listPage(query: PageQuery): Promise<Page<RoleRecord>> {
    const roles = await this.roles.list();
    return toPage(roles.slice(query.offset, query.offset + query.limit), roles.length, query);
  }

  async get(id: string): Promise<RoleRecord> {
    const role = await this.roles.get(id);
    if (role === undefined) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async createSubRole(input: CreateSubRole, actor: Actor): Promise<RoleRecord> {
    const existing = await this.roles.get(input.id);
    if (existing !== undefined) throw new ConflictException(`Role ${input.id} already exists`);
    const role = await this.roles.createSubRole(input);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.roleCreate, { subject: role.id, detail: { name: role.name, kind: role.kind } }));
    return role;
  }

  async removeSubRole(id: string, actor: Actor): Promise<void> {
    const role = await this.get(id);
    if (role.kind !== "sub") throw new ConflictException(`Primary role ${id} cannot be removed`);
    await this.roles.removeSubRole(id);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.roleDelete, { subject: id, detail: { name: role.name } }));
  }

  async setPermissions(roleId: string, codes: string[], actor: Actor): Promise<RoleRecord> {
    const role = await this.get(roleId);
    const catalog = new Set((await this.roles.listPermissions()).map((permission) => permission.code));
    const unknown = codes.filter((code) => !catalog.has(code));
    if (unknown.length > 0) throw new BadRequestException(`Unknown permission codes: ${unknown.join(", ")}`);
    const notHeld = codes.filter((code) => !role.permissions.includes(code) && !actor.permissions.includes(code));
    if (notHeld.length > 0) throw new ForbiddenException(`Cannot grant permissions you do not hold: ${notHeld.join(", ")}`);
    if (role.id === ADMIN_ROLE_ID) {
      const removed = ADMIN_LOCKED_PERMISSIONS.filter((code) => !codes.includes(code));
      if (removed.length > 0) throw new ConflictException(`The admin role must keep: ${removed.join(", ")}`);
    }
    const updated = await this.roles.setPermissions(role.id, codes);
    if (updated === undefined) throw new NotFoundException(`Role ${roleId} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.rolePermissionsUpdate, {
        subject: role.id,
        detail: {
          added: codes.filter((code) => !role.permissions.includes(code)).sort(),
          removed: role.permissions.filter((code) => !codes.includes(code)).sort(),
        },
      }),
    );
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
