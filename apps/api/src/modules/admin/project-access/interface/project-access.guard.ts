// Project Access on the portal's project-scoped routes (ADR-0062, ADR-0099 decision 4): the signed-in user needs an
// explicit grant on the project of `:id`, an administrator included. It runs after the global guards, so the session
// and the route's own permission are already settled; the member API checks the same service in its own guard.

import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "../application/project-access.service.js";

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly access: ProjectAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ sessionUser?: Actor; params: Record<string, string | undefined> }>();
    const user = request.sessionUser;
    if (user === undefined) throw new UnauthorizedException("Missing session");
    const projectId = request.params["id"];
    if (projectId === undefined || projectId.length === 0) throw new ForbiddenException("Project scope is required");
    await this.access.requireRead(user.id, projectId);
    return true;
  }
}
