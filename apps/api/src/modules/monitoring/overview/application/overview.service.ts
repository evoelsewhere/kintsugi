// Application layer: the monitoring overview. Composes the read model's records into counts,
// an attention list (what needs a person: failed or stuck runs, failed writes, repositories in
// sync error) and an activity feed, plus the worker's queue health. A queue that cannot be
// read never fails the overview: its queues are reported as null.

import { Injectable } from "@nestjs/common";
import { nowIso } from "#common/util/time.js";
import {
  type ActivityItem,
  type AttentionItem,
  type MonitoredRepository,
  type MonitoringOverview,
  OVERVIEW_LIMITS,
  type QueueCount,
  type RunRecord,
  type WriteRecord,
} from "../domain/overview.js";
import { MonitoringReadModel, QueueHealth } from "../domain/overview.ports.js";

/** How long the overview waits for the queue counts before reporting them as unknown. */
const QUEUE_TIMEOUT_MS = 3000;

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }));

/** Newest first; ISO-8601 UTC strings sort as text. */
const newestFirst = (a: { at: string }, b: { at: string }): number => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

/** The first line of a commit message: the pull-request title. */
const firstLine = (message: string): string => message.split("\n", 1)[0]!.trim();

const runLabel = (run: RunRecord): string => (run.applicationId === undefined ? run.name : `${run.name} · ${run.applicationId}`);

const runRefs = (run: RunRecord) => ({ projectId: run.projectId, ...optional("applicationId", run.applicationId), jobRunId: run.id });

const writeRefs = (write: WriteRecord) => ({ projectId: write.projectId, ...optional("applicationId", write.applicationId), documentWriteId: write.id });

@Injectable()
export class OverviewService {
  constructor(
    private readonly model: MonitoringReadModel,
    private readonly queueHealth: QueueHealth,
  ) {}

  async overview(): Promise<MonitoringOverview> {
    const { attention: attentionLimit, activity: activityLimit, attentionDays, stuckAfterMinutes } = OVERVIEW_LIMITS;
    const [counts, failedRuns, stuckRuns, failedWrites, repositoryErrors, recentRuns, recentWrites, times, queues] = await Promise.all([
      this.model.counts(),
      this.model.failedRuns(attentionDays, attentionLimit),
      this.model.stuckRuns(stuckAfterMinutes, attentionLimit),
      this.model.failedWrites(attentionDays, attentionLimit),
      this.model.repositoryErrors(attentionLimit),
      this.model.recentRuns(activityLimit),
      this.model.recentWrites(activityLimit),
      this.model.workerTimes(),
      this.#queues(),
    ]);

    const attention: AttentionItem[] = [
      ...failedRuns.map((run): AttentionItem => ({ kind: "run-failed", at: run.at, title: `${run.name} failed`, ...optional("detail", run.failureReason), ...runRefs(run) })),
      ...stuckRuns.map(
        (run): AttentionItem => ({
          kind: "run-stuck",
          at: run.at,
          title: `${run.name} queued for ${run.queuedMinutes} min`,
          detail: "The worker has not picked it up",
          ...runRefs(run),
        }),
      ),
      ...failedWrites.map((write): AttentionItem => ({ kind: "write-failed", at: write.at, title: firstLine(write.message), ...optional("detail", write.error), ...writeRefs(write) })),
      ...repositoryErrors.map((repository): AttentionItem => ({ kind: "repository-error", at: repository.at, title: repository.id, ...optional("detail", repository.lastError), repositoryId: repository.id })),
    ];

    const activity: ActivityItem[] = [
      ...recentRuns.map((run): ActivityItem => ({ kind: "run", at: run.at, status: run.status, title: runLabel(run), ...runRefs(run), ...optional("actor", run.actor) })),
      ...recentWrites.map(
        (write): ActivityItem => ({
          kind: "write",
          at: write.at,
          status: write.status,
          title: firstLine(write.message),
          ...writeRefs(write),
          ...optional("actor", write.actor),
          ...optional("prUrl", write.prUrl),
          ...optional("branch", write.branch),
        }),
      ),
    ];

    return {
      generatedAt: nowIso(),
      counts,
      attention: attention.sort(newestFirst).slice(0, attentionLimit),
      activity: activity.sort(newestFirst).slice(0, activityLimit),
      worker: { queues, ...times },
    };
  }

  repositories(): Promise<MonitoredRepository[]> {
    return this.model.repositories();
  }

  /** The queue counts, or null when they cannot be read in time. */
  async #queues(): Promise<QueueCount[] | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), QUEUE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.queueHealth.queues(), timeout]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
