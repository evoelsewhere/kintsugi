// Application layer: use cases for members (Admin · Identity & Access, A2).
//
// Guard rails on top of the `members.manage` route permission:
//   - an actor can only assign roles, and manage members, whose permissions they hold
//     themselves — `members.manage` is not a path to self-escalation or account takeover;
//   - the installation always keeps one enabled admin, and nobody removes or disables
//     themselves;
//   - a member holds exactly one primary role plus optional sub-roles;
//   - password resets and disabling end the member's sessions.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "../../../../common/auth/decorators.js";
import { ADMIN_ROLE_ID, RolesService } from "../../roles/application/roles.service.js";
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

  async create(input: CreateUser, actor: Actor): Promise<UserRecord> {
    await this.#assertUsernameFree(input.username);
    await this.#assertAssignable(input.roleIds ?? [], [], actor);
    return this.users.create(newId(), input, hashPassword(input.password));
  }

  /** Bootstrap only: the first admin of an empty installation (ADR-0008). */
  async createFirstAdmin(username: string, password: string): Promise<UserRecord> {
    if ((await this.users.count()) > 0) throw new ConflictException("The installation already has members");
    return this.users.create(newId(), { username, password, displayName: "Admin", roleIds: [ADMIN_ROLE_ID] }, hashPassword(password));
  }

  async update(id: string, input: UpdateUser, actor: Actor): Promise<UserRecord> {
    const target = await this.get(id);
    await this.#assertCanManage(target, actor);
    if (input.roleIds !== undefined) await this.#assertAssignable(input.roleIds, target.roleIds, actor);

    const disabling = input.enabled === false && target.enabled;
    if (disabling && target.id === actor.id) throw new ConflictException("You cannot disable your own account");
    const losesAdmin = disabling || (input.roleIds !== undefined && !input.roleIds.includes(ADMIN_ROLE_ID));
    if (losesAdmin) await this.#assertNotLastAdmin(target);

    const updated = await this.users.update(id, input);
    if (updated === undefined) throw new NotFoundException(`User ${id} not found`);
    if (disabling) await this.users.revokeSessions(id);
    return updated;
  }

  async setPassword(id: string, password: string, actor: Actor): Promise<void> {
    await this.#assertCanManage(await this.get(id), actor);
    await this.users.setPassword(id, hashPassword(password));
    await this.users.revokeSessions(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const target = await this.get(id);
    if (target.id === actor.id) throw new ConflictException("You cannot remove your own account");
    await this.#assertCanManage(target, actor);
    await this.#assertNotLastAdmin(target);
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

  async #assertUsernameFree(username: string): Promise<void> {
    const existing = await this.users.findByUsername(username);
    if (existing !== undefined) throw new ConflictException(`Username ${username} already exists`);
  }

  /** Exactly one primary role; every newly added role only carries permissions the actor holds. */
  async #assertAssignable(roleIds: string[], currentRoleIds: string[], actor: Actor): Promise<void> {
    const roles = await Promise.all(roleIds.map((roleId) => this.roles.get(roleId)));
    if (roles.filter((role) => role.kind === "primary").length !== 1) {
      throw new BadRequestException("A member needs exactly one primary role");
    }
    for (const role of roles) {
      if (currentRoleIds.includes(role.id)) continue;
      const notHeld = role.permissions.filter((code) => !actor.permissions.includes(code));
      if (notHeld.length > 0) {
        throw new ForbiddenException(`Cannot assign role ${role.id}: it grants permissions you do not hold (${notHeld.join(", ")})`);
      }
    }
  }

  /** The actor must hold every permission of the member they change (no takeover of stronger accounts). */
  async #assertCanManage(target: UserRecord, actor: Actor): Promise<void> {
    if (target.id === actor.id) return;
    const targetPermissions = await this.roles.permissionsOfUser(target.id);
    if (targetPermissions.some((code) => !actor.permissions.includes(code))) {
      throw new ForbiddenException(`Cannot manage ${target.username}: they hold permissions you do not`);
    }
  }

  async #assertNotLastAdmin(target: UserRecord): Promise<void> {
    if (!target.enabled || !target.roleIds.includes(ADMIN_ROLE_ID)) return;
    if ((await this.users.countEnabledWithRole(ADMIN_ROLE_ID)) <= 1) {
      throw new ConflictException("The installation must keep at least one enabled admin");
    }
  }
}
