// The trigger of the aggregate rebuild (ADR-0033): when the Git sync sees a new default-branch tip
// of a project's document repository, the applications whose per-item files changed (identified by
// the domain layout module) get a `rebuild` stage run, unless one is already queued. The rebuild
// regenerates the whole-application views and the writer auto-commits them.

import { randomUUID } from "node:crypto";
import { appFromUnitPath } from "@kintsugi/domain";
import { runGit } from "@kintsugi/git";
import type { Pool } from "pg";
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The applications whose per-unit files are among `paths`, sorted. */
export function appsTouched(paths: readonly string[]): string[] {
  const apps = new Set<string>();
  for (const path of paths) {
    const app = appFromUnitPath(path);
    if (app !== undefined) apps.add(app);
  }
  return [...apps].sort();
}

export interface RebuildTriggerDeps {
  pool: Pool;
  /** Hands a queued run to the worker (queue `job-run`). */
  enqueue(jobRunId: string): Promise<void>;
  log(message: string): void;
}

/** A default-branch move of a repository's mirror. */
export interface TipMove {
  repositoryId: string;
  mirror: string;
  previous: string;
  commit: string;
}

/** Queues a rebuild for every application whose items changed between the two tips; returns the run ids. */
export async function triggerRebuilds(deps: RebuildTriggerDeps, move: TipMove): Promise<string[]> {
  if (!COMMIT.test(move.previous) || !COMMIT.test(move.commit) || move.previous === move.commit) return [];
  const projects = await deps.pool.query<{ project_id: string }>("select project_id from admin.project_repository where repository_id = $1 and role = 'document'", [move.repositoryId]);
  if (projects.rows.length === 0) return [];
  const diff = await runGit(["diff", "--name-only", move.previous, move.commit], { cwd: move.mirror });
  const apps = appsTouched(diff.stdout.split(/\r?\n/));
  if (apps.length === 0) return [];
  const started: string[] = [];
  for (const { project_id: projectId } of projects.rows) {
    for (const app of apps) {
      // Every legacy repository of the application, in the order they were linked (ADR-0052).
      const legacy = await deps.pool.query<{ repository_id: string }>(
        "select repository_id from admin.project_repository where project_id = $1 and application_id = $2 and role = 'legacy' order by created_at, repository_id",
        [projectId, app],
      );
      const repositories = legacy.rows.map((row) => row.repository_id);
      if (repositories.length === 0) continue;
      const id = randomUUID();
      // One queued or running rebuild per application: a later tip is covered by the run that starts after it.
      const inserted = await deps.pool.query(
        `insert into workflow.job_run (id, project_id, application_id, kind, name, source_repository_id, sources, actor)
         select $1, $2, $3, 'stage', 'rebuild', $4, $5::jsonb, 'kintsugi'
          where not exists (select 1 from workflow.job_run where project_id = $2 and application_id = $3 and name = 'rebuild' and parent_id is null and status = 'queued')`,
        [id, projectId, app, repositories[0], JSON.stringify(repositories.map((repositoryId) => ({ repositoryId })))],
      );
      if ((inserted.rowCount ?? 0) === 0) continue;
      await deps.enqueue(id);
      started.push(id);
      deps.log(`rebuild of ${projectId}/${app} queued: its items changed on the default branch (${move.previous.slice(0, 12)}..${move.commit.slice(0, 12)})`);
    }
  }
  return started;
}
