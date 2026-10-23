// Application layer: the sandbox view of Monitoring (ADR-0058) — the job workspaces on disk with the run behind each, and
// the admin's request to remove one. Depends on the domain ports only.

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { InstallationSettingsService } from "#modules/admin/settings/index.js";
import { JOB_ID, WorkspaceDisk, WorkspaceRemovals, WorkspaceRuns, type WorkspaceView, removalBlocker, removalTime } from "../domain/sandbox.js";

export interface SandboxWorkspaces {
  workspaces: WorkspaceView[];
  /** The retention the removal times are computed with (Settings -> Sandbox). */
  retentionDays: number;
}

@Injectable()
export class SandboxService {
  constructor(
    private readonly disk: WorkspaceDisk,
    private readonly runs: WorkspaceRuns,
    private readonly removals: WorkspaceRemovals,
    private readonly settings: InstallationSettingsService,
    private readonly audit: AuditTrail,
  ) {}

  async workspaces(): Promise<SandboxWorkspaces> {
    const found = await this.disk.list();
    const [states, sandbox] = await Promise.all([this.runs.states(found.map((entry) => entry.jobId)), this.settings.sandbox()]);
    return {
      retentionDays: sandbox.retentionDays,
      workspaces: found.map((entry) => {
        const run = states.get(entry.jobId);
        const blockedBy = removalBlocker(run);
        const removalAt = removalTime(run, entry.modifiedAt, sandbox.retentionDays);
        return { ...entry, ...(run === undefined ? {} : { run }), ...(removalAt === undefined ? {} : { removalAt }), ...(blockedBy === undefined ? {} : { blockedBy }) };
      }),
    };
  }

  /**
   * Asks the worker to remove a workspace. Refused while its run is active or the write of its output is pending: the
   * worker reads the state again before it deletes, so a run that starts in between is still safe.
   */
  async remove(jobId: string, actor: Actor): Promise<void> {
    if (!JOB_ID.test(jobId) || !(await this.disk.exists(jobId))) throw new NotFoundException(`No workspace for job ${jobId} on this server`);
    const run = (await this.runs.states([jobId])).get(jobId);
    const blocked = removalBlocker(run);
    if (blocked !== undefined) throw new ConflictException(`The workspace of ${jobId} cannot be removed now: ${blocked}`);
    await this.removals.request(jobId, actor.username ?? actor.id);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.sandboxWorkspaceRemove, {
        subject: jobId,
        ...(run === undefined ? {} : { projectId: run.projectId }),
        detail: { run: run === undefined ? null : { name: run.name, status: run.status, attempt: run.attempt } },
      }),
    );
  }
}
