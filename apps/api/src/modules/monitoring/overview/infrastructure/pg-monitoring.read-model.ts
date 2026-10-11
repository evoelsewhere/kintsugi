// Postgres read model of the monitoring overview (ADR-0010): aggregate queries across
// admin.project, admin.application, admin.git_repository, admin.project_repository,
// workflow.job_run, workflow.document_write, governance.gate and workflow.worker_heartbeat
// (migrations 006, 008, 009, 010, 013, 014). Read-only;
// time windows use the database clock. Never selects a credential or restricted content.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import type {
  MonitoredRepository,
  OverviewCounts,
  PendingGateRecord,
  RepositoryErrorRecord,
  RepositoryLink,
  RepositorySyncStatus,
  RunRecord,
  StuckRunRecord,
  WorkerRecord,
  WorkerTimes,
  WriteRecord,
} from "../domain/overview.js";
import { MonitoringReadModel } from "../domain/overview.ports.js";

interface RunRow {
  id: string;
  project_id: string;
  application_id: string | null;
  name: string;
  status: string;
  failure_reason: string | null;
  actor: string | null;
  at: Date;
}

interface WriteRow {
  id: string;
  project_id: string;
  application_id: string | null;
  status: string;
  message: string;
  error: string | null;
  actor: string | null;
  pr_url: string | null;
  branch: string | null;
  at: Date;
}

const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } => (value === null ? {} : ({ [key]: value } as { [P in K]?: V }));

const RUN_COLUMNS = "r.id, r.project_id, r.application_id, r.name, r.status, r.failure_reason, r.actor, coalesce(r.finished_at, r.started_at, r.created_at) as at";

// The application of a write is that of the run that produced it, when there is one.
const WRITE_SELECT = `
  select w.id, w.project_id, (select r.application_id from workflow.job_run r where r.document_write_id = w.id order by r.created_at limit 1) as application_id,
         w.status, w.message, w.error, w.actor, w.pr_url, w.branch, w.updated_at as at
    from workflow.document_write w`;

const toRun = (row: RunRow): RunRecord => ({
  id: row.id,
  projectId: row.project_id,
  ...optional("applicationId", row.application_id),
  name: row.name,
  status: row.status,
  ...optional("failureReason", row.failure_reason),
  ...optional("actor", row.actor),
  at: row.at.toISOString(),
});

const toWrite = (row: WriteRow): WriteRecord => ({
  id: row.id,
  projectId: row.project_id,
  ...optional("applicationId", row.application_id),
  status: row.status,
  message: row.message,
  ...optional("error", row.error),
  ...optional("actor", row.actor),
  ...optional("prUrl", row.pr_url),
  ...optional("branch", row.branch),
  at: row.at.toISOString(),
});

@Injectable()
export class PgMonitoringReadModel extends MonitoringReadModel {
  get #pool(): Pool {
    return getPool();
  }

  async counts(): Promise<OverviewCounts> {
    const result = await this.#pool.query<{
      projects: number;
      applications: number;
      queued_runs: number;
      running_runs: number;
      failed_runs_24h: number;
      succeeded_runs_24h: number;
      pending_writes: number;
      pull_requests_7d: number;
      failed_writes_24h: number;
      repositories: number;
      repositories_with_errors: number;
      repositories_not_ready: number;
      pending_gates: number;
    }>(`
      select (select count(*)::int from admin.project) as projects,
             (select count(*)::int from admin.application) as applications,
             (select count(*)::int from governance.gate where status = 'pending') as pending_gates,
             runs.queued_runs, runs.running_runs, runs.failed_runs_24h, runs.succeeded_runs_24h,
             writes.pending_writes, writes.pull_requests_7d, writes.failed_writes_24h,
             repos.repositories, repos.repositories_with_errors, repos.repositories_not_ready
        from (select count(*) filter (where status = 'queued')::int as queued_runs,
                     count(*) filter (where status = 'running')::int as running_runs,
                     count(*) filter (where status = 'failed' and coalesce(finished_at, created_at) >= now() - interval '24 hours')::int as failed_runs_24h,
                     count(*) filter (where status = 'succeeded' and coalesce(finished_at, created_at) >= now() - interval '24 hours')::int as succeeded_runs_24h
                from workflow.job_run where parent_id is null) runs,
             (select count(*) filter (where status = 'queued')::int as pending_writes,
                     count(*) filter (where status = 'pr-opened' and created_at >= now() - interval '7 days')::int as pull_requests_7d,
                     count(*) filter (where status = 'failed' and updated_at >= now() - interval '24 hours')::int as failed_writes_24h
                from workflow.document_write) writes,
             (select count(*)::int as repositories,
                     count(*) filter (where sync_status = 'error')::int as repositories_with_errors,
                     count(*) filter (where sync_status in ('pending', 'cloning'))::int as repositories_not_ready
                from admin.git_repository) repos`);
    const row = result.rows[0]!;
    return {
      projects: row.projects,
      applications: row.applications,
      activeRuns: row.queued_runs + row.running_runs,
      queuedRuns: row.queued_runs,
      runningRuns: row.running_runs,
      failedRuns24h: row.failed_runs_24h,
      succeededRuns24h: row.succeeded_runs_24h,
      pendingWrites: row.pending_writes,
      pullRequests7d: row.pull_requests_7d,
      failedWrites24h: row.failed_writes_24h,
      repositories: row.repositories,
      repositoriesWithErrors: row.repositories_with_errors,
      repositoriesNotReady: row.repositories_not_ready,
      pendingGates: row.pending_gates,
    };
  }

  async pendingGates(limit: number): Promise<PendingGateRecord[]> {
    const result = await this.#pool.query<{ id: string; project_id: string; application_id: string | null; gate_key: string; title: string; requested_by: string; at: Date }>(
      `select id, project_id, application_id, gate_key, title, requested_by, requested_at as at from governance.gate
        where status = 'pending' order by requested_at, id limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      ...optional("applicationId", row.application_id),
      gateKey: row.gate_key,
      title: row.title,
      requestedBy: row.requested_by,
      at: row.at.toISOString(),
    }));
  }

  async workers(): Promise<WorkerRecord[]> {
    const result = await this.#pool.query<{
      worker_id: string;
      host: string;
      pid: number;
      version: string;
      started_at: Date;
      last_seen_at: Date;
      stopped_at: Date | null;
      seconds_since_seen: number;
      active_jobs: number;
      queues: string[];
    }>(
      `select worker_id, host, pid, version, started_at, last_seen_at, stopped_at,
              greatest(0, floor(extract(epoch from now() - last_seen_at)))::int as seconds_since_seen, active_jobs, queues
         from workflow.worker_heartbeat order by last_seen_at desc, worker_id`,
    );
    return result.rows.map((row) => ({
      workerId: row.worker_id,
      host: row.host,
      pid: row.pid,
      version: row.version,
      startedAt: row.started_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      ...optional("stoppedAt", row.stopped_at?.toISOString() ?? null),
      secondsSinceSeen: row.seconds_since_seen,
      activeJobs: row.active_jobs,
      queues: row.queues,
    }));
  }

  async failedRuns(days: number, limit: number): Promise<RunRecord[]> {
    const result = await this.#pool.query<RunRow>(
      `select ${RUN_COLUMNS} from workflow.job_run r
        where r.parent_id is null and r.status = 'failed' and coalesce(r.finished_at, r.created_at) >= now() - make_interval(days => $1)
        order by at desc, r.id limit $2`,
      [days, limit],
    );
    return result.rows.map(toRun);
  }

  async stuckRuns(minutes: number, limit: number): Promise<StuckRunRecord[]> {
    const result = await this.#pool.query<RunRow & { queued_minutes: number }>(
      `select ${RUN_COLUMNS}, floor(extract(epoch from now() - r.created_at) / 60)::int as queued_minutes from workflow.job_run r
        where r.parent_id is null and r.status = 'queued' and r.created_at < now() - make_interval(mins => $1)
        order by r.created_at, r.id limit $2`,
      [minutes, limit],
    );
    return result.rows.map((row) => ({ ...toRun(row), queuedMinutes: row.queued_minutes }));
  }

  async failedWrites(days: number, limit: number): Promise<WriteRecord[]> {
    const result = await this.#pool.query<WriteRow>(
      `${WRITE_SELECT} where w.status = 'failed' and w.updated_at >= now() - make_interval(days => $1) order by w.updated_at desc, w.id limit $2`,
      [days, limit],
    );
    return result.rows.map(toWrite);
  }

  async repositoryErrors(limit: number): Promise<RepositoryErrorRecord[]> {
    const result = await this.#pool.query<{ id: string; last_error: string | null; at: Date }>(
      `select id, last_error, greatest(updated_at, last_synced_at) as at from admin.git_repository
        where sync_status = 'error' order by at desc, id limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({ id: row.id, ...optional("lastError", row.last_error), at: row.at.toISOString() }));
  }

  async recentRuns(limit: number): Promise<RunRecord[]> {
    const result = await this.#pool.query<RunRow>(`select ${RUN_COLUMNS} from workflow.job_run r where r.parent_id is null order by at desc, r.id limit $1`, [limit]);
    return result.rows.map(toRun);
  }

  async recentWrites(limit: number): Promise<WriteRecord[]> {
    const result = await this.#pool.query<WriteRow>(`${WRITE_SELECT} order by w.updated_at desc, w.id limit $1`, [limit]);
    return result.rows.map(toWrite);
  }

  async workerTimes(): Promise<WorkerTimes> {
    const result = await this.#pool.query<{ last_git_sync_at: Date | null; oldest_queued_run_at: Date | null }>(
      `select (select max(last_synced_at) from admin.git_repository) as last_git_sync_at,
              (select min(created_at) from workflow.job_run where parent_id is null and status = 'queued') as oldest_queued_run_at`,
    );
    const row = result.rows[0]!;
    return {
      ...optional("lastGitSyncAt", row.last_git_sync_at?.toISOString() ?? null),
      ...optional("oldestQueuedRunAt", row.oldest_queued_run_at?.toISOString() ?? null),
    };
  }

  async repositories(): Promise<MonitoredRepository[]> {
    const [repositories, links] = await Promise.all([
      this.#pool.query<{
        id: string;
        server_id: string;
        url: string;
        default_branch: string | null;
        sync_status: RepositorySyncStatus;
        last_commit: string | null;
        last_synced_at: Date | null;
        last_error: string | null;
      }>("select id, server_id, url, default_branch, sync_status, last_commit, last_synced_at, last_error from admin.git_repository order by id"),
      this.#pool.query<{ repository_id: string; project_id: string; role: string; application_id: string | null; component: string | null }>(
        "select repository_id, project_id, role, application_id, component from admin.project_repository order by project_id, application_id nulls first, role",
      ),
    ]);
    const byRepository = new Map<string, RepositoryLink[]>();
    for (const link of links.rows) {
      const list = byRepository.get(link.repository_id) ?? [];
      list.push({ projectId: link.project_id, role: link.role, ...optional("applicationId", link.application_id), ...optional("component", link.component) });
      byRepository.set(link.repository_id, list);
    }
    return repositories.rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      url: row.url,
      ...optional("defaultBranch", row.default_branch),
      syncStatus: row.sync_status,
      ...optional("lastCommit", row.last_commit),
      ...optional("lastSyncedAt", row.last_synced_at?.toISOString() ?? null),
      ...optional("lastError", row.last_error),
      projects: byRepository.get(row.id) ?? [],
    }));
  }
}
