// Global guards: CSRF protection for cookie sessions, authentication everywhere
// (except @Public routes), and dynamic permission checks from the catalog.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY, MEMBER_READ_SCOPE_KEY, PERMISSION_KEY, SIGNED_WEBHOOK_KEY, SKIP_CSRF_KEY, type MemberReadScope } from "#common/auth/decorators.js";
import { bearerToken, passesCsrfCheck, sessionToken } from "#common/auth/session-cookie.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { AuthService, type SessionUser } from "../application/auth.service.js";
import { isMemberTokenCredential, MemberTokenService, type MemberPrincipal } from "../application/member-token.service.js";

/** Request carrying the authenticated user and optional restricted member principal. */
export interface AuthenticatedRequest extends Request {
  sessionUser?: SessionUser;
  memberPrincipal?: MemberPrincipal;
}

/** Unsafe requests riding the session cookie must carry the CSRF header. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const signedWebhook = this.reflector.getAllAndOverride<boolean>(SIGNED_WEBHOOK_KEY, [context.getHandler(), context.getClass()]);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]);
    if (signedWebhook === true || skipCsrf === true) return true;
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
    private readonly memberTokens: MemberTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const bearer = bearerToken(request);
    if (bearer !== undefined && isMemberTokenCredential(bearer)) {
      const principal = await this.memberTokens.authenticateMemberToken(bearer);
      if (principal === undefined) throw new UnauthorizedException("Invalid or expired token");
      const user = await this.auth.authenticateUser(principal.userId);
      if (user === undefined) throw new UnauthorizedException("Invalid or expired token");
      request.memberPrincipal = principal;
      request.sessionUser = user;
      return true;
    }

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
  constructor(
    private readonly reflector: Reflector,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    const scope = this.reflector.getAllAndOverride<MemberReadScope | undefined>(MEMBER_READ_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.memberPrincipal === undefined && scope === undefined && required === undefined) return true;
    const user = request.sessionUser;
    if (user === undefined) throw new UnauthorizedException("Missing session");

    if (request.memberPrincipal !== undefined && scope === undefined) {
      throw new ForbiddenException("Coding Agent Workflow tokens require an explicitly scoped read route");
    }

    if (scope !== undefined) {
      if (request.method !== "GET") throw new ForbiddenException("Coding Agent Workflow routes are read-only");
      if (!user.permissions.includes("member.read")) throw new ForbiddenException("Missing permission: member.read");
      if (required?.some((code) => code !== "member.read")) throw new ForbiddenException("Coding Agent Workflow tokens cannot satisfy installation permissions");
      if (scope.projectIdFrom === "token-projects") {
        if (request.memberPrincipal === undefined) {
          throw new ForbiddenException("A project-scoped Coding Agent Workflow token is required");
        }
      } else {
        const projectId = this.#projectId(request, scope);
        if (projectId === undefined) throw new ForbiddenException("Project scope is required");
        if (request.memberPrincipal !== undefined && !request.memberPrincipal.projectIds.includes(projectId)) {
          throw new ForbiddenException("Token is not scoped to this project");
        }
        await this.projectAccess.requireRead(user.id, projectId);
      }
    }

    if (request.memberPrincipal !== undefined) return true;
    if (required === undefined) return true;
    if (!required.some((code) => user.permissions.includes(code))) {
      throw new ForbiddenException(`Missing permission: ${required.join(" or ")}`);
    }
    return true;
  }

  #projectId(request: AuthenticatedRequest, scope: MemberReadScope): string | undefined {
    if (scope.projectIdFrom === "token-projects") return undefined;
    const raw = scope.projectIdFrom === "query" ? request.query["projectId"] : request.params["projectId"];
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
}
