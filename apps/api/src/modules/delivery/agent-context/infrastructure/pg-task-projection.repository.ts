// Durable rebuildable task projections. Assignment resolution uses an exact enabled username.

import { Injectable } from "@nestjs/common";
import { getPool, withTransaction } from "#common/db/pool.js";
import { applicationIdsFingerprint } from "./task-configuration.js";
import {
  TaskProjectionRepository,
  type AssignmentState,
  type IndexedMemberTask,
  type MemberTaskProjection,
  type ProjectTaskSnapshot,
  type TaskIndexRevision,
} from "../domain/task.js";

interface IndexedTaskRow {
  project_id: string;
  unit_id: string;
  repository_id: string;
  source_commit: string;
  source_path: string;
  source_hash: string;
  work_item: MemberTaskProjection["workItem"];
  required_inputs: MemberTaskProjection["requiredInputs"];
  source_references: MemberTaskProjection["sourceReferences"];
  predecessor_gates: MemberTaskProjection["predecessorGates"];
  assignment_state: AssignmentState;
  assigned_user_id: string | null;
}

const TASK_SELECT = [
  "select t.project_id, t.unit_id, t.repository_id, t.source_commit, t.source_path, t.source_hash,",
  "       t.work_item, t.required_inputs, t.source_references, t.predecessor_gates,",
  "       case when t.assignee is null or btrim(t.assignee) = '' then 'unassigned'",
  "            when u.id is null then 'unresolved' else 'resolved' end as assignment_state,",
  "       u.id as assigned_user_id",
  "  from delivery.member_task_projection t",
  "  left join core.app_user u on u.username = t.assignee and u.enabled = true",
].join("\n");

@Injectable()
export class PgTaskProjectionRepository extends TaskProjectionRepository {
  constructor() {
    super();
  }

  async indexRevision(projectId: string): Promise<TaskIndexRevision | undefined> {
    const result = await getPool().query<{ repository_id: string; source_commit: string; application_ids_fingerprint: string; index_id: string }>(
      "select repository_id, source_commit, application_ids_fingerprint, index_id from delivery.member_task_index where project_id = $1",
      [projectId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { repositoryId: row.repository_id, commit: row.source_commit, applicationIdsFingerprint: row.application_ids_fingerprint, indexId: row.index_id };
  }

  async replaceProject(snapshot: ProjectTaskSnapshot, expectedIndex: TaskIndexRevision | undefined): Promise<boolean> {
    return withTransaction(async (client) => {
      // The parent row exists even for an initial index. Lock before any projection DELETE:
      // locking an absent index/projection cannot serialize initial refreshes.
      const project = await client.query("select id from admin.project where id = $1 for update", [snapshot.projectId]);
      if (project.rowCount !== 1) return false;
      // Lock FK parents before destructive child changes. An application DELETE otherwise
      // takes the opposite lock order through its cascade, or removes a task's FK parent.
      const applications = await client.query<{ id: string }>(
        'select id from admin.application where project_id = $1 order by id collate "C" for key share',
        [snapshot.projectId],
      );
      if (applicationIdsFingerprint(applications.rows.map(({ id }) => id)) !== snapshot.applicationIdsFingerprint) return false;
      const current = await client.query<{ index_id: string }>(
        "select index_id from delivery.member_task_index where project_id = $1", [snapshot.projectId]);
      if (current.rows[0]?.index_id !== expectedIndex?.indexId) return false;
      await client.query("delete from delivery.member_task_projection where project_id = $1", [snapshot.projectId]);
      await client.query("delete from delivery.member_task_index_issue where project_id = $1", [snapshot.projectId]);

      const taskRows = snapshot.tasks.map((task) => ({
        application_id: task.unitId.split("/")[0] ?? "",
        unit_id: task.unitId,
        repository_id: task.repositoryId,
        source_commit: task.sourceCommit,
        source_path: task.sourcePath,
        source_hash: task.sourceHash,
        assignee: task.workItem.assignee ?? null,
        work_item: task.workItem,
        required_inputs: task.requiredInputs,
        source_references: task.sourceReferences,
        predecessor_gates: task.predecessorGates,
      }));
      await client.query(
        "insert into delivery.member_task_projection " +
          "(project_id, application_id, unit_id, repository_id, source_commit, source_path, source_hash, " +
          " assignee, work_item, required_inputs, source_references, predecessor_gates) " +
          "select $1, entry.application_id, entry.unit_id, entry.repository_id, entry.source_commit, " +
          "entry.source_path, entry.source_hash, entry.assignee, entry.work_item, entry.required_inputs, " +
          "entry.source_references, entry.predecessor_gates " +
          "from jsonb_to_recordset($2::jsonb) as entry(" +
          "application_id text, unit_id text, repository_id text, source_commit text, source_path text, " +
          "source_hash text, assignee text, work_item jsonb, required_inputs jsonb, source_references jsonb, " +
          "predecessor_gates jsonb)",
        [snapshot.projectId, JSON.stringify(taskRows)],
      );

      const issueRows = snapshot.issues.map((issue) => ({ source_path: issue.path, messages: issue.messages }));
      await client.query(
        "insert into delivery.member_task_index_issue (project_id, source_commit, source_path, messages) " +
          "select $1, $2, entry.source_path, entry.messages " +
          "from jsonb_to_recordset($3::jsonb) as entry(source_path text, messages jsonb)",
        [snapshot.projectId, snapshot.commit, JSON.stringify(issueRows)],
      );

      await client.query(
        "insert into delivery.member_task_index (project_id, repository_id, source_commit, task_count, issue_count, application_ids_fingerprint, indexed_at) " +
          "values ($1, $2, $3, $4, $5, $6, now()) " +
          "on conflict (project_id) do update set repository_id = excluded.repository_id, " +
          "source_commit = excluded.source_commit, task_count = excluded.task_count, " +
          "issue_count = excluded.issue_count, application_ids_fingerprint = excluded.application_ids_fingerprint, " +
          "index_id = excluded.index_id, indexed_at = excluded.indexed_at",
        [snapshot.projectId, snapshot.repositoryId, snapshot.commit, snapshot.tasks.length, snapshot.issues.length, snapshot.applicationIdsFingerprint],
      );
      return true;
    });
  }

  async list(projectId: string): Promise<IndexedMemberTask[]> {
    const result = await getPool().query<IndexedTaskRow>(
      TASK_SELECT + " where t.project_id = $1 order by t.unit_id",
      [projectId],
    );
    return result.rows.map(toTask);
  }

  async get(projectId: string, unitId: string): Promise<IndexedMemberTask | undefined> {
    const result = await getPool().query<IndexedTaskRow>(
      TASK_SELECT + " where t.project_id = $1 and t.unit_id = $2",
      [projectId, unitId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toTask(row);
  }
}

function toTask(row: IndexedTaskRow): IndexedMemberTask {
  return {
    projectId: row.project_id,
    unitId: row.unit_id,
    repositoryId: row.repository_id,
    sourceCommit: row.source_commit,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    workItem: row.work_item,
    requiredInputs: row.required_inputs,
    sourceReferences: row.source_references,
    predecessorGates: row.predecessor_gates,
    assignmentState: row.assignment_state,
    ...(row.assigned_user_id === null ? {} : { assignedUserId: row.assigned_user_id }),
  };
}
