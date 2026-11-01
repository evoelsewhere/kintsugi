// Application layer: sign-in, sessions and the bootstrap admin (ADR-0008).
// The first admin comes from KINTSUGI_BOOTSTRAP_ADMIN_* — there is no default password.

import { HttpException, HttpStatus, Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { loadBootstrapAdmin } from "#common/config/env.js";
import { isDatabaseUnavailable } from "#common/db/errors.js";
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
  readonly #logger = new Logger(AuthService.name);

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

  /** Checks a username and password the way a sign-in does (same lockout) without creating a session. */
  async verifyCredentials(username: string, password: string): Promise<SessionUser> {
    // The attempt is counted before the password is checked: guesses sent at once cannot all pass the limit.
    const retryAfter = await this.throttle.begin(username);
    if (retryAfter !== undefined) {
      throw new HttpException(
        `Too many failed sign-ins for this account; try again in ${Math.ceil(retryAfter / 60)} min`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let user: UserRecord | undefined;
    let checked = false;
    try {
      user = await this.users.validateCredentials(username, password);
      checked = true;
    } catch (error) {
      // A check that did not finish is not a wrong password: the attempt is not counted. A database out of reach answers
      // 503 so the person tries again; anything else (input the database refuses: 400) keeps its own answer.
      if (!isDatabaseUnavailable(error)) throw error;
      this.#logger.warn(`sign-in check failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException("Sign-in is unavailable right now; try again in a moment");
    } finally {
      this.throttle.end(username, checked ? user !== undefined : undefined);
    }
    if (user === undefined) throw new UnauthorizedException("Invalid username or password");
    return this.sessionUser(user);
  }

  async login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const user = await this.verifyCredentials(username, password);
    return { token: await this.sessions.create(user.id), user };
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
