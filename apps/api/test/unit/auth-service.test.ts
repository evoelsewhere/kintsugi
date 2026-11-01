import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RolesService } from "#modules/admin/roles/index.js";
import type { UserRecord, UsersService } from "#modules/admin/users/index.js";
import { AuthService } from "#modules/core/auth/application/auth.service.js";
import { LoginThrottle } from "#modules/core/auth/application/login-throttle.js";
import type { SessionRepository } from "#modules/core/auth/domain/session.repository.js";

const alice = { id: "u1", username: "alice", displayName: "Alice", roleIds: [], enabled: true } as unknown as UserRecord;

/** A sign-in service whose user store answers with `check` (a function that may throw like a failed database). */
function service(check: (password: string) => Promise<UserRecord | undefined>): { auth: AuthService; throttle: LoginThrottle } {
  const throttle = new LoginThrottle();
  const users = { validateCredentials: (_username: string, password: string) => check(password) } as unknown as UsersService;
  const roles = { permissionsOfUser: async () => [] } as unknown as RolesService;
  const sessions = { create: async () => "token" } as unknown as SessionRepository;
  return { auth: new AuthService(users, roles, sessions, throttle), throttle };
}

const statusOf = (promise: Promise<unknown>): Promise<number> =>
  promise.then(
    () => 200,
    (error: unknown) => (error instanceof HttpException ? error.getStatus() : 500),
  );

describe("AuthService sign-in", () => {
  it("answers 503 when the user store fails, and does not count the attempt as a failure", async () => {
    let down = true;
    const { auth, throttle } = service(async (password) => {
      if (down) throw new Error("connection terminated unexpectedly");
      return password === "right" ? alice : undefined;
    });
    // More failed checks than the limit allows: none of them is a wrong password.
    for (let i = 0; i < 6; i++) expect(await statusOf(auth.verifyCredentials("alice", "right"))).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(throttle.retryAfter("alice")).toBeUndefined();
    down = false;
    expect(await statusOf(auth.verifyCredentials("alice", "right"))).toBe(200);
  });

  it("still locks the account after five wrong passwords", async () => {
    const { auth, throttle } = service(async (password) => (password === "right" ? alice : undefined));
    for (let i = 0; i < 5; i++) expect(await statusOf(auth.verifyCredentials("alice", "wrong"))).toBe(HttpStatus.UNAUTHORIZED);
    expect(throttle.retryAfter("alice")).toBeGreaterThan(0);
    expect(await statusOf(auth.verifyCredentials("alice", "right"))).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });
});
