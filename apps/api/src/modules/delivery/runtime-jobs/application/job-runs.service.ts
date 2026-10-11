// Application layer: use cases of runtime job runs (ADR-0027, ADR-0029). The API never runs a
// job: it checks that the stage can start (the application has a legacy repository, the
// project a document repository), records the run and enqueues it for the worker.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import { sleep } from "#common/util/async.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import {
  FINAL_RUN_STATUSES,
  type JobRunDetail,
  type JobRunFilter,
  type JobRunFollowUpdate,
  type JobRunView,
  RUNNABLE_STAGES,
  type RestrictedRecordFilter,
  type RestrictedRecordSummary,
  type RestrictedRecordView,
  type RunnableStage,
} from "../domain/job-run.js";

/** How often a follower looks for new events, and how many it takes at a time. */
const FOLLOW_POLL_MS = 1000;
const FOLLOW_BATCH = 200;
import { JobRunQueue, JobRunStore } from "../domain/job-run.ports.js";

@Injectable()
export class JobRunsService {
  constructor(
    private readonly store: JobRunStore,
    private readonly queue: JobRunQueue,
    private readonly projects: ProjectsService,
    private readonly audit: AuditTrail,
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
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.stageRun, { projectId, subject: run.id, detail: { stage, applicationId } }));
    return run;
  }

  async list(projectId: string, applicationId: string | undefined, query: PageQuery): Promise<Page<JobRunView>> {
    await this.projects.getProject(projectId); // 404 for an unknown project
    const { items, total } = await this.store.list(projectId, applicationId, query.limit, query.offset);
    return toPage(items, total, query);
  }

  /** Top-level runs across projects (for the runs overview), newest first. */
  async listAll(filter: JobRunFilter, query: PageQuery): Promise<Page<JobRunView>> {
    const { items, total } = await this.store.listAll(filter, query.limit, query.offset);
    return toPage(items, total, query);
  }

  /**
   * Restricted records across projects, metadata only (never decrypted, so not audited); the
   * content is read per run through restricted(), which is audited.
   */
  async listRestricted(filter: RestrictedRecordFilter, query: PageQuery): Promise<Page<RestrictedRecordSummary>> {
    const { items, total } = await this.store.restrictedSummaries(filter, query.limit, query.offset);
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
  /**
   * Cancels a top-level run: a queued run is cancelled at once; for a running one the worker is
   * asked to stop it (its processes are killed, the run ends as `cancelled`).
   */
  async cancel(projectId: string, id: string, actor: Actor): Promise<JobRunView> {
    const run = await this.summary(projectId, id);
    if (run.parentId !== undefined) throw new BadRequestException(`Job run ${id} is a step of ${run.parentId}; cancel that run instead`);
    const outcome = await this.store.cancel(projectId, id, actor.username ?? actor.id);
    if (outcome === "finished") throw new ConflictException(`Job run ${id} has already finished (${run.status})`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.jobRunCancel, { projectId, subject: id, detail: { outcome, name: run.name } }));
    return this.summary(projectId, id);
  }

  /** A run without its steps and artifacts; 404 when unknown. */
  async summary(projectId: string, id: string): Promise<JobRunView> {
    const run = await this.store.summary(projectId, id);
    if (run === undefined) throw new NotFoundException(`Job run ${id} not found in project ${projectId}`);
    return run;
  }

  /**
   * Follows a run for a live view: its events after `afterId`, its status whenever it changes,
   * and `end` once it has finished and every event was delivered. Stops early when `signal` aborts.
   */
  async *follow(projectId: string, id: string, afterId: string | undefined, signal: AbortSignal): AsyncGenerator<JobRunFollowUpdate> {
    let last = afterId;
    let status: string | undefined;
    while (!signal.aborted) {
      const run = await this.summary(projectId, id);
      const events = await this.store.events(id, last, FOLLOW_BATCH);
      for (const event of events) {
        last = event.id;
        yield { type: "event", event };
      }
      if (run.status !== status) {
        status = run.status;
        yield { type: "status", run };
      }
      if (FINAL_RUN_STATUSES.includes(run.status) && events.length < FOLLOW_BATCH) {
        // Events written just before the final status are in this batch or the next query.
        for (const event of await this.store.events(id, last, FOLLOW_BATCH)) yield { type: "event", event };
        yield { type: "end", run };
        return;
      }
      if (events.length < FOLLOW_BATCH) await sleep(FOLLOW_POLL_MS, signal);
    }
  }

  async restricted(projectId: string, id: string, actor: Actor): Promise<RestrictedRecordView[]> {
    await this.get(projectId, id);
    const records = await this.store.restricted(projectId, id);
    await this.audit.record(
      records.map((record) => auditRecord(actor, AUDIT_ACTIONS.restrictedRead, { projectId, subject: record.jobRunId, detail: { path: record.path, topLevelRun: id } })),
    );
    return records;
  }
}
