// Cross-cutting auth decorators. Route access:
//   - default: authentication required (AuthGuard, registered globally)
//   - @Public(): no authentication (login, health)
//   - @RequirePermission("code"): additionally requires the permission (PermissionsGuard)

import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "kintsugi:is-public";
export const PERMISSION_KEY = "kintsugi:required-permission";

/** Marks a route as reachable without a session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires one permission code from the caller's effective roles. */
export const RequirePermission = (code: string): MethodDecorator & ClassDecorator => SetMetadata(PERMISSION_KEY, code);
