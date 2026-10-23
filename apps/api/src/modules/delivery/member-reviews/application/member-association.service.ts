import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import {
  MemberAssociationRepository,
  type MemberAssociationConfirmation,
} from "../domain/member-association.js";

@Injectable()
export class MemberAssociationService {
  constructor(
    private readonly associations: MemberAssociationRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly audit: AuditTrail,
  ) {}

  async listNeedsConfirmation(projectId: string, limit: number, offset: number, actor: Actor) {
    this.#require(actor, "workitems.manage");
    await this.projectAccess.requireRead(actor.id, projectId);
    return this.associations.listNeedsConfirmation(projectId, limit, offset);
  }

  async mapProviderActor(input: {
    projectId: string;
    serverId: string;
    providerActorId: string;
    userId: string;
  }, actor: Actor): Promise<void> {
    this.#require(actor, "project.access.manage");
    const result = await this.associations.mapProviderActor({ ...input, confirmedBy: actor.id });
    switch (result.status) {
      case "created":
        await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.providerActorMap, {
          projectId: input.projectId,
          subject: `${input.serverId}:${input.providerActorId}`,
          detail: { userId: input.userId },
        }));
        return;
      case "unchanged":
        return;
      case "repository-not-linked":
      case "user-not-authorized":
        throw new NotFoundException("Provider repository or authorized project user was not found");
      case "mapping-conflict":
        throw new ConflictException("This provider actor is already mapped to a different project user");
    }
  }

  async confirm(input: Omit<MemberAssociationConfirmation, "confirmedBy">, actor: Actor): Promise<{ association: { state: "confirmed"; source: "maintainer" } }> {
    this.#require(actor, "workitems.manage");
    await this.projectAccess.requireRead(actor.id, input.projectId);
    const result = await this.associations.confirm({ ...input, confirmedBy: actor.id });
    switch (result.status) {
      case "confirmed":
        await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.memberPrAssociate, {
          projectId: input.projectId,
          subject: `${input.serverId}:${input.providerRepositoryId}:${input.providerPullRequestId}`,
          detail: { unitId: input.unitId, deliverableCount: input.deliverableIds.length },
        }));
        return { association: { state: "confirmed", source: "maintainer" } };
      case "unchanged":
        return { association: { state: "confirmed", source: "maintainer" } };
      case "observation-not-found":
        throw new NotFoundException("Observed pull request was not found");
      case "task-not-found":
        throw new NotFoundException("Task was not found");
      case "repository-not-linked":
        throw new ConflictException("Pull-request repository is not a declared deliverable repository for this task");
      case "context-unavailable":
        throw new ConflictException("The pinned task context is unavailable or expired; refresh the task context before associating this pull request");
      case "invalid-association":
        throw new ConflictException("The pull request base branch or deliverables do not match the pinned task context");
      case "association-conflict":
        throw new ConflictException("This pull request already has a different confirmed task association");
    }
  }

  #require(actor: Actor, permission: string): void {
    if (!actor.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
  }
}
