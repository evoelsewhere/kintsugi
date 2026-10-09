// Application layer: sign-in, sessions and the bootstrap admin (ADR-0008).
// Dev default credentials: admin / admin@1234 (override with KINTSUGI_BOOTSTRAP_ADMIN_*).

import { Injectable, OnApplicationBootstrap, UnauthorizedException } from "@nestjs/common";
import type { UserRecord } from "../../../admin/users/domain/user.js";
import { UsersService } from "../../../admin/users/application/users.service.js";
import { RolesService } from "../../../admin/roles/application/roles.service.js";
import { PgSessionRepository } from "../infrastructure/pg-session.repository.js";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  roleIds: string[];
  permissions: string[];
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly sessions: PgSessionRepository,
  ) {}

  /** Creates the first admin when the installation has no users yet. */
  async onApplicationBootstrap(): Promise<void> {
    if ((await this.users.count()) > 0) return;
    const username = process.env["KINTSUGI_BOOTSTRAP_ADMIN_USER"] ?? "admin";
    const password = process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] ?? "admin@1234";
    await this.users.create({ username, password, displayName: "Admin", roleIds: ["admin"] });
  }

  async login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const user = await this.users.validateCredentials(username, password);
    if (user === undefined) throw new UnauthorizedException("Invalid username or password");
    const token = await this.sessions.create(user.id);
    return { token, user: await this.sessionUser(user) };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }

  async sessionUser(user: UserRecord): Promise<SessionUser> {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roleIds: user.roleIds,
      permissions: await this.roles.permissionsOfUser(user.id),
    };
  }

  /** Validates a bearer token → session user (used by the global AuthGuard). */
  async authenticate(token: string): Promise<SessionUser | undefined> {
    const userId = await this.sessions.validate(token);
    if (userId === undefined) return undefined;
    const user = await this.users.get(userId);
    if (!user.enabled) return undefined;
    return this.sessionUser(user);
  }
}
