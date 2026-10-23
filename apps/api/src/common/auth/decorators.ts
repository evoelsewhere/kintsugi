// Cross-cutting auth decorators. Route access:
//   - default: authentication required (AuthGuard, registered globally)
//   - @Public(): no authentication (login, health)
//   - @RequirePermission("code", …): additionally requires one of the permissions (PermissionsGuard)
//   - @CurrentActor(): injects the signed-in caller into a handler parameter

import { createParamDecorator, type ExecutionContext, SetMetadata, UnauthorizedException } from "@nestjs/common";

export const IS_PUBLIC_KEY = "kintsugi:is-public";
export const PERMISSION_KEY = "kintsugi:required-permission";
export const MEMBER_READ_SCOPE_KEY = "kintsugi:member-read-scope";

export interface MemberReadScope {
  projectIdFrom: "query" | "params" | "body" | "token-projects";
  /** Allows POST as well: the route records something about the member's own work and changes no project data. */
  write?: boolean;
}

export const SKIP_CSRF_KEY = "kintsugi:skip-csrf";

/** The signed-in caller as seen by use cases: identity plus effective permissions. */
export interface Actor {
  id: string;
  /** Sign-in name, used for provenance (e.g. the `Kintsugi-Actor` commit trailer). */
  username?: string;
  permissions: string[];
}

/**
 * Exempts a route from the CSRF header check. For a route that never takes the session cookie and authenticates every
 * request itself (the debug MCP server, ADR-0056); never for one that does.
 */
export const SkipCsrf = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_CSRF_KEY, true);

/** Marks a route as reachable without a session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires at least one of the permission codes from the caller's effective roles.
 * A method-level decorator overrides the class-level one.
 */
export const RequirePermission = (...codes: [string, ...string[]]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSION_KEY, codes);

/** Marks an endpoint as a project-scoped Kintsugi member route: GET, or POST when the scope is a write. */
export const AllowMemberRead = (scope: MemberReadScope): MethodDecorator & ClassDecorator => SetMetadata(MEMBER_READ_SCOPE_KEY, scope);

/** The caller set by AuthGuard; only valid on authenticated (non-@Public) routes. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const actor = context.switchToHttp().getRequest<{ sessionUser?: Actor }>().sessionUser;
  if (actor === undefined) throw new UnauthorizedException("Missing session");
  return actor;
});
