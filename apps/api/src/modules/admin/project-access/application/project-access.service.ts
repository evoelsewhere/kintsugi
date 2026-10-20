// Application layer for explicit Project Access. Assignment and project roles are not grants.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import type { ProjectAccessGrant } from "../domain/project-access.repository.js";
import { ProjectAccessRepository } from "../domain/project-access.repository.js";

@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly access: ProjectAccessRepository,
    private readonly audit: AuditTrail,
  ) {}

  async list(projectId: string, actor: Actor): Promise<ProjectAccessGrant[]> {
    this.#requireManagementPermission(actor);
    if (!(await this.access.projectExists(projectId))) throw new NotFoundException("Project not found");
    return this.access.list(projectId);
  }

  async grant(projectId: string, userId: string, actor: Actor): Promise<void> {
    this.#requireManagementPermission(actor);
    const [projectExists, userExists] = await Promise.all([this.access.projectExists(projectId), this.access.userExists(userId)]);
    if (!projectExists || !userExists) throw new NotFoundException("Project or user not found");
    const created = await this.access.grant(projectId, userId, actor.id);
    if (created) {
      await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.projectAccessGrant, { projectId, subject: userId }));
    }
  }

  async revoke(projectId: string, userId: string, actor: Actor): Promise<void> {
    this.#requireManagementPermission(actor);
    const removed = await this.access.revoke(projectId, userId);
    if (removed) {
      await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.projectAccessRevoke, { projectId, subject: userId }));
    }
  }

  async requireRead(userId: string, projectId: string): Promise<void> {
    if (!(await this.access.has(userId, projectId))) throw new ForbiddenException("Project Access is required");
  }

  #requireManagementPermission(actor: Actor): void {
    if (!actor.permissions.includes("project.access.manage")) throw new ForbiddenException("Missing permission: project.access.manage");
  }
}
