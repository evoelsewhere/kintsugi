// What Postgres says about the runs behind the job workspaces (workflow.job_run and its document write).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import { type RunState, WorkspaceRuns } from "../domain/sandbox.js";

interface Row {
  id: string;
  project_id: string;
  application_id: string | null;
  kind: string;
  name: string;
  status: string;
  attempt: number;
  created_at: Date;
  finished_at: Date | null;
  write_status: string | null;
}

@Injectable()
export class PgWorkspaceRuns extends WorkspaceRuns {
  async states(jobIds: readonly string[]): Promise<Map<string, RunState>> {
    if (jobIds.length === 0) return new Map();
    const result = await getPool().query<Row>(
      `select r.id, r.project_id, r.application_id, r.kind, r.name, r.status, r.attempt, r.created_at, r.finished_at, w.status as write_status
         from workflow.job_run r left join workflow.document_write w on w.id = r.document_write_id
        where r.id = any($1)`,
      [jobIds],
    );
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          projectId: row.project_id,
          ...(row.application_id === null ? {} : { applicationId: row.application_id }),
          kind: row.kind,
          name: row.name,
          status: row.status,
          attempt: row.attempt,
          createdAt: row.created_at.toISOString(),
          ...(row.finished_at === null ? {} : { finishedAt: row.finished_at.toISOString() }),
          ...(row.write_status === null ? {} : { writeStatus: row.write_status }),
        },
      ]),
    );
  }
}
