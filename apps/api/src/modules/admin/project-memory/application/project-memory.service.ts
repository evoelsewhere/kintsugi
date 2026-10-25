import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import { ProjectMemoryRepository } from "../domain/project-memory.repository.js";

@Injectable()
export class ProjectMemoryService {
  constructor(private readonly memory: ProjectMemoryRepository, private readonly audit: AuditTrail) {}

  async view(projectId: string, offset: number, limit: number, actor: Actor) {
    this.requireManagement(actor);
    const view = await this.memory.view(projectId, offset, limit);
    if (view === undefined) throw new NotFoundException("Project not found");
    return view;
  }

  async configure(projectId: string, enabled: boolean, actor: Actor): Promise<void> {
    await this.view(projectId, 0, 1, actor);
    await this.memory.configure(projectId, enabled);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.projectMemoryConfigure, { projectId, detail: { enabled } }));
  }

  async reset(projectId: string, actor: Actor): Promise<void> {
    await this.view(projectId, 0, 1, actor);
    await this.memory.reset(projectId);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.projectMemoryReset, { projectId }));
  }

  async review(projectId: string, id: string, state: "approved" | "rejected", actor: Actor): Promise<void> {
    this.requireManagement(actor);
    if (!(await this.memory.review(projectId, id, state, actor.id))) throw new NotFoundException("Memory entry not found");
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.projectMemoryReview, { projectId, subject: id, detail: { state } }));
  }

  async forget(projectId: string, id: string, actor: Actor) {
    await this.view(projectId,0,1,actor);
    const result = await this.memory.forgetManaged(projectId,id);
    if (result === undefined) throw new NotFoundException("Memory entry not found");
    await this.audit.recordChange(auditRecord(actor,AUDIT_ACTIONS.projectMemoryForget,{projectId,subject:id}));
    return result;
  }
  async restore(projectId: string, recoveryId: string, actor: Actor) {
    await this.view(projectId,0,1,actor);
    const result = await this.memory.restoreManaged(projectId,recoveryId);
    if (result === undefined) throw new NotFoundException("Recovery record not found");
    await this.audit.recordChange(auditRecord(actor,AUDIT_ACTIONS.projectMemoryRestore,{projectId,subject:result.id}));
    return result;
  }

  private requireManagement(actor: Actor): void {
    if (!actor.permissions.includes("project.memory.manage")) throw new ForbiddenException("Missing permission: project.memory.manage");
  }
}
