// Application layer: sign-in, sessions and the bootstrap admin (ADR-0008).
// The first admin comes from KINTSUGI_BOOTSTRAP_ADMIN_* — there is no default password.

import { HttpException, HttpStatus, Injectable, OnApplicationBootstrap, UnauthorizedException } from "@nestjs/common";
import { loadBootstrapAdmin } from "#common/config/env.js";
import type { UserRecord } from "#modules/admin/users/index.js";
import { UsersService } from "#modules/admin/users/index.js";
import { RolesService } from "#modules/admin/roles/index.js";
import { SessionRepository } from "../domain/session.repository.js";
import { LoginThrottle } from "./login-throttle.js";

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
    private readonly sessions: SessionRepository,
    private readonly throttle: LoginThrottle,
  ) {}

  /** Creates the first admin when the installation has no users yet. */
  async onApplicationBootstrap(): Promise<void> {
    if ((await this.users.count()) > 0) return;
    const { username, password } = loadBootstrapAdmin();
    await this.users.createFirstAdmin(username, password);
  }

  async login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const retryAfter = this.throttle.retryAfter(username);
    if (retryAfter !== undefined) {
      throw new HttpException(
        `Too many failed sign-ins for this account; try again in ${Math.ceil(retryAfter / 60)} min`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.users.validateCredentials(username, password);
    if (user === undefined) {
      this.throttle.recordFailure(username);
      throw new UnauthorizedException("Invalid username or password");
    }
    this.throttle.recordSuccess(username);
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

  /** Validates a session token → session user (used by the global AuthGuard). */
  async authenticate(token: string): Promise<SessionUser | undefined> {
    const userId = await this.sessions.validate(token);
    return userId === undefined ? undefined : this.authenticateUser(userId);
  }

  /** Loads the current enabled identity and permissions for a non-session credential. */
  async authenticateUser(userId: string): Promise<SessionUser | undefined> {
    const user = await this.users.get(userId);
    if (user === undefined || !user.enabled) return undefined;
    return this.sessionUser(user);
  }
}
