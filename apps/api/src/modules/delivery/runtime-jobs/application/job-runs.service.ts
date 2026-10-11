// Application layer: use cases of runtime job runs (ADR-0027, ADR-0029). The API never runs a
// job: it checks that the stage can start (the application has a legacy repository, the
// project a document repository), records the run and enqueues it for the worker.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import { AUDIT_ACTIONS, AuditService } from "#modules/governance/audit/index.js";
import { type JobRunDetail, type JobRunView, RUNNABLE_STAGES, type RestrictedRecordView, type RunnableStage } from "../domain/job-run.js";
import { JobRunQueue, JobRunStore } from "../domain/job-run.ports.js";

@Injectable()
export class JobRunsService {
  constructor(
    private readonly store: JobRunStore,
    private readonly queue: JobRunQueue,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  /** Starts a stage for one application: records the run as `queued` and enqueues it. */
  async runStage(projectId: string, applicationId: string, stage: string, actor: Actor): Promise<JobRunView> {
    if (!(RUNNABLE_STAGES as readonly string[]).includes(stage)) {
      throw new BadRequestException(`Stage "${stage}" cannot be run yet (available: ${RUNNABLE_STAGES.join(", ")})`);
    }
    const project = await this.projects.getProject(projectId);
    const application = project.applications.find((entry) => entry.id === applicationId);
    if (application === undefined) throw new NotFoundException(`Application ${applicationId} not found in project ${projectId}`);
    if (project.documentRepository === null) throw new ConflictException(`Project ${projectId} has no document repository`);
    const legacy = application.asIs.legacy[0];
    if (legacy === undefined) throw new ConflictException(`Application ${applicationId} has no legacy repository; register one on the application first`);

    const run = await this.store.createStageRun({
      id: newId(),
      projectId,
      applicationId,
      stage: stage as RunnableStage,
      sourceRepositoryId: legacy.repositoryId,
      actor: actor.username ?? actor.id,
    });
    try {
      await this.queue.enqueue(run.id);
    } catch (error) {
      await this.store.markFailed(run.id, `Could not enqueue the run: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return run;
  }

  async list(projectId: string, applicationId: string | undefined, query: PageQuery): Promise<Page<JobRunView>> {
    await this.projects.getProject(projectId); // 404 for an unknown project
    const { items, total } = await this.store.list(projectId, applicationId, query.limit, query.offset);
    return toPage(items, total, query);
  }

  async get(projectId: string, id: string): Promise<JobRunDetail> {
    const run = await this.store.get(projectId, id);
    if (run === undefined) throw new NotFoundException(`Job run ${id} not found in project ${projectId}`);
    return run;
  }

  /**
   * The restricted records of a run, decrypted. Every record read is audited first (who, when,
   * job run, path; never the content); when the audit entry cannot be stored, nothing is returned.
   */
  async restricted(projectId: string, id: string, actor: Actor): Promise<RestrictedRecordView[]> {
    await this.get(projectId, id);
    const records = await this.store.restricted(projectId, id);
    await this.audit.record(
      records.map((record) => ({
        actor: actor.id,
        action: AUDIT_ACTIONS.restrictedRead,
        projectId,
        subject: record.jobRunId,
        detail: { path: record.path, topLevelRun: id, ...(actor.username === undefined ? {} : { username: actor.username }) },
      })),
    );
    return records;
  }
}
