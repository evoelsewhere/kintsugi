// Application layer: use cases of runtime job runs (ADR-0027, ADR-0029). The API never runs a
// job: it checks that the stage can start (the application has a legacy repository, the
// project a document repository), records the run and enqueues it for the worker.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import type { SourceRepo } from "@kintsugi/domain";
import { ChangeFeed } from "#common/realtime/change-feed.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import {
  FINAL_RUN_STATUSES,
  type JobRunDetail,
  type JobRunFilter,
  type JobRunFollowUpdate,
  type JobRunView,
  type RestrictedRecordFilter,
  type RestrictedRecordSummary,
  type RestrictedRecordView,
} from "../domain/job-run.js";

/** The understand stage (ADR-0033): it runs on a selection of catalog items, several runs at once. */
const UNDERSTAND = "understand";
/** The design stage (ADR-0049): one design set for a selection of units, several runs at once. */
export const DESIGN = "design";
/** Stages that run on a selection and several at a time. */
const SCOPED_STAGES: readonly string[] = [UNDERSTAND, DESIGN];

/**
 * A follower reads again when the database says the run changed (change feed); this is how long it waits at most
 * without a notice, in case one was lost. And how many events it takes at a time.
 */
const FOLLOW_SAFETY_MS = 30_000;
const FOLLOW_BATCH = 200;
import { JobRunQueue, JobRunStore, StageCatalog } from "../domain/job-run.ports.js";

@Injectable()
export class JobRunsService {
  constructor(
    private readonly store: JobRunStore,
    private readonly queue: JobRunQueue,
    private readonly projects: ProjectsService,
    private readonly audit: AuditTrail,
    private readonly stages: StageCatalog,
    private readonly feed: ChangeFeed,
  ) {}

  /**
   * Starts a stage for one application: records the run as `queued` and enqueues it. 409 when
   * the stage cannot start: no document or legacy repository, a run of it already queued or
   * running, or an earlier stage it reads has never succeeded for the application. (Whether that
   * stage's output is merged on the document repo's default branch is checked by the worker.)
   */
  async runStage(projectId: string, applicationId: string, stage: string, actor: Actor): Promise<JobRunView> {
    if (stage === UNDERSTAND) {
      throw new BadRequestException(`The understand stage runs on a selection of catalog items: POST /projects/${projectId}/applications/${applicationId}/understand/runs with the items or modules`);
    }
    if (stage === DESIGN) {
      throw new BadRequestException(`The design stage generates one design set for a selection of units: POST /projects/${projectId}/applications/${applicationId}/design/runs with the set and the units`);
    }
    return this.startRun(projectId, applicationId, stage, actor);
  }

  /**
   * Checks that a stage can start for an application and returns the repositories the run reads: the project has a
   * document repository, the application a legacy one, no other run of the stage is active (the scoped stages
   * excepted), and the stages it reads from have succeeded. 400/404/409 otherwise.
   */
  async #checkStart(projectId: string, applicationId: string, stage: string): Promise<SourceRepo[]> {
    const plans = this.stages.plans(applicationId);
    const plan = plans.find((entry) => entry.id === stage);
    if (plan === undefined) {
      throw new BadRequestException(`Stage "${stage}" cannot be run yet (available: ${plans.map((entry) => entry.id).join(", ")})`);
    }
    const project = await this.projects.getProject(projectId);
    const application = project.applications.find((entry) => entry.id === applicationId);
    if (application === undefined) throw new NotFoundException(`Application ${applicationId} not found in project ${projectId}`);
    if (project.documentRepository === null) throw new ConflictException(`Project ${projectId} has no document repository`);
    // Every legacy repository of the application is read, in the order they were linked (ADR-0052), and every target
    // repository (the to-be) is mounted beside them, read-only (ADR-0055).
    if (application.asIs.legacy.length === 0) throw new ConflictException(`Application ${applicationId} has no legacy repository; register one on the application first`);
    const sources: SourceRepo[] = [
      ...application.asIs.legacy.map((repository): SourceRepo => ({ repositoryId: repository.repositoryId, role: "legacy" })),
      ...application.toBe.targets.map((repository): SourceRepo => ({ repositoryId: repository.repositoryId, role: "target" })),
    ];
    if (!SCOPED_STAGES.includes(stage) && (await this.store.hasStageRun(projectId, applicationId, stage, ["queued", "running"]))) {
      throw new ConflictException(`A ${stage} run of ${applicationId} is already queued or running; wait for it or cancel it first`);
    }
    for (const prerequisite of plan.requires) {
      if (!(await this.store.hasStageRun(projectId, applicationId, prerequisite.stage, ["succeeded"]))) {
        throw new ConflictException(
          `Run ${prerequisite.stage} for ${applicationId} first: ${stage} reads ${prerequisite.path}, which ${prerequisite.stage} writes (merge its pull request before running ${stage})`,
        );
      }
    }
    return sources;
  }

  /**
   * Records a top-level stage run as `queued` and enqueues it. `inputs` pin what the run reads (scope,
   * documentsCommit: ADR-0033). Several understand or design runs may be active at once (each on its own items
   * or units); any other stage runs once at a time per application.
   */
  async startRun(projectId: string, applicationId: string, stage: string, actor: Actor, options: { inputs?: Record<string, unknown> } = {}): Promise<JobRunView> {
    const sources = await this.#checkStart(projectId, applicationId, stage);

    const run = await this.store.createStageRun({
      id: newId(),
      projectId,
      applicationId,
      stage,
      sources,
      actor: actor.username ?? actor.id,
      ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    });
    try {
      await this.queue.enqueue(run.id);
    } catch (error) {
      await this.store.markFailed(run.id, `Could not enqueue the run: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.stageRun, { projectId, subject: run.id, detail: { stage, applicationId, ...(run.scope === undefined ? {} : { items: run.scope.items.length }) } }));
    return run;
  }

  /**
   * Retries a failed stage run (ADR-0055): the same run goes back in the queue as its next attempt, in the same
   * workspace, on the same pinned commits, scope and documents; the worker skips the steps whose inputs did not
   * change and whose results are still there. `fresh` begins from nothing instead (the job's results and ledger are
   * discarded; the pins stay). 409 unless the run failed, or another run of the stage is active.
   */
  async retry(projectId: string, id: string, actor: Actor, options: { fresh?: boolean } = {}): Promise<JobRunView> {
    const run = await this.summary(projectId, id);
    if (run.parentId !== undefined || run.kind !== "stage" || run.applicationId === undefined) throw new BadRequestException(`Job run ${id} is not a stage run of an application`);
    if (run.status !== "failed") throw new ConflictException(`Job run ${id} did not fail (${run.status}): only a failed run is retried`);
    // The same conditions as a start: the stage may be running for another reason by now, or a stage it reads may have been undone.
    await this.#checkStart(projectId, run.applicationId, run.name);
    const fresh = options.fresh === true;
    // The documents the failed attempt read stay the ones the job reads.
    const read = run.outputSummary?.["documentsCommit"];
    if (!(await this.store.requeue(projectId, id, { fresh, ...(typeof read === "string" ? { documentsCommit: read } : {}) }))) throw new ConflictException(`Job run ${id} is no longer failed`);
    try {
      await this.queue.enqueue(id);
    } catch (error) {
      await this.store.markFailed(id, `Could not enqueue the retry: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    const retried = await this.summary(projectId, id);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.jobRunRetry, { projectId, subject: id, detail: { name: run.name, attempt: retried.attempt, fresh } }));
    return retried;
  }

  /**
   * Abandons the pull request of a succeeded understand or design run that was closed without merging: its
   * items (units) are released and can be selected again. 409 when the run has no open pull request or was
   * abandoned already.
   */
  async abandon(projectId: string, id: string, actor: Actor): Promise<JobRunView> {
    const run = await this.summary(projectId, id);
    if (run.parentId !== undefined || run.kind !== "stage" || !SCOPED_STAGES.includes(run.name)) throw new BadRequestException(`Job run ${id} is not an understand or design run`);
    if (run.status !== "succeeded" || run.documentWrite?.status !== "pr-opened") throw new ConflictException(`Job run ${id} has no pull request to abandon`);
    if (!(await this.store.abandon(projectId, id, actor.username ?? actor.id))) throw new ConflictException(`Job run ${id} was abandoned already`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.jobRunAbandon, { projectId, subject: id, detail: { name: run.name, items: run.scope?.items.length ?? 0 } }));
    return this.summary(projectId, id);
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
    // Watching starts before the first read, and a notice that comes while reading is kept: none is missed.
    const watcher = this.feed.watch((change) => (change.topic === "job-events" && change.scope === id) || (change.topic === "job-runs" && change.scope === projectId), signal);
    try {
      while (!signal.aborted) {
        watcher.clear();
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
        if (events.length < FOLLOW_BATCH) await watcher.wait(FOLLOW_SAFETY_MS);
      }
    } finally {
      watcher.close();
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
