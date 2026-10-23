import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { isFullUnitId } from "@kintsugi/domain";
import type { TaskIdentity, TaskPullRequest } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { MemberAssociationRepository } from "../domain/member-association.js";

const MAX_TASK_PULL_REQUESTS = 100;

@Injectable()
export class TaskPullRequestQueryService {
  constructor(
    private readonly associations: MemberAssociationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async listForTask(principal: MemberPrincipal, identity: TaskIdentity): Promise<TaskPullRequest[]> {
    if (!principal.projectIds.includes(identity.projectId)) {
      throw new ForbiddenException("The token is not scoped to this project");
    }
    if (!isFullUnitId(identity.unitId)) throw new BadRequestException("unitId must be application/module/unit");
    await this.projectAccess.requireRead(principal.userId, identity.projectId);

    const page = await this.associations.listConfirmedForTask(identity, MAX_TASK_PULL_REQUESTS);
    if (page.hasMore) {
      throw new PayloadTooLargeException("The task has too many associated pull requests for the status response");
    }
    return page.items;
  }
}
