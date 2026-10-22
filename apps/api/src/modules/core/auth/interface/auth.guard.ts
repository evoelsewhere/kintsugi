// Global guards: CSRF protection for cookie sessions, authentication everywhere
// (except @Public routes) and dynamic permission checks (@RequirePermission codes
// come from core.permission rows).

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY, PERMISSION_KEY, SKIP_CSRF_KEY } from "#common/auth/decorators.js";
import { passesCsrfCheck, sessionToken } from "#common/auth/session-cookie.js";
import { AuthService, type SessionUser } from "../application/auth.service.js";

/** Request carrying the authenticated session user (set by AuthGuard). */
export interface AuthenticatedRequest extends Request {
  sessionUser?: SessionUser;
}

/** Unsafe requests riding the session cookie must carry the CSRF header (see session-cookie.ts). */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]) === true) return true;
    if (!passesCsrfCheck(context.switchToHttp().getRequest<Request>())) {
      throw new ForbiddenException("Missing CSRF header");
    }
    return true;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = sessionToken(request);
    if (token === undefined) throw new UnauthorizedException("Not signed in");
    const user = await this.auth.authenticate(token);
    if (user === undefined) throw new UnauthorizedException("Invalid or expired session");
    request.sessionUser = user;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (required === undefined) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.sessionUser;
    if (user === undefined) throw new UnauthorizedException("Missing session");

    if (!required.some((code) => user.permissions.includes(code))) {
      throw new ForbiddenException(`Missing permission: ${required.join(" or ")}`);
    }
    return true;
  }
}
