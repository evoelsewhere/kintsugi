// PostgreSQL snapshot manifest/source index and its atomic worker-retention outbox intent.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { recordTransition } from "@kintsugi/orchestrator/outbox";
import { SNAPSHOT_RETENTION_QUEUE } from "@kintsugi/orchestrator/queues";
import { getPool, withTransaction } from "#common/db/pool.js";
import {
  SnapshotRepository,
  type SnapshotCursorInput,
  type SnapshotCursorRecord,
  type SnapshotCreateInput,
  type SnapshotManifest,
  type SnapshotRecord,
  type SnapshotSource,
  type SnapshotStatus,
  SnapshotLeaseUnavailableError,
} from "../domain/snapshot.js";

interface SnapshotRow {
  snapshot_id: string;
  requested_by_user_id: string;
  task: SnapshotRecord["workItem"];
  readiness: SnapshotRecord["readiness"];
  manifest: SnapshotManifest;
  status: SnapshotStatus;
  failure_code: string | null;
  created_at: Date;
  expires_at: Date;
}

interface CursorRow {
  cursor_id: string;
  snapshot_id: string;
  cursor_kind: SnapshotCursorRecord["kind"];
  source_id: string | null;
  section_id: string | null;
  character_offset: number | null;
  query_hash: string | null;
  result_offset: number | null;
}

@Injectable()
export class PgSnapshotRepository extends SnapshotRepository {
  async create(snapshot: SnapshotCreateInput): Promise<void> {
    if (!Number.isSafeInteger(snapshot.retentionMs) || snapshot.retentionMs < 1) {
      throw new TypeError("snapshot retentionMs must be a positive safe integer");
    }
    const { manifest } = snapshot;
    const sourceRows = manifest.sources.map((source) => ({
      source_id: source.sourceId,
      role: source.role,
      repository_id: source.repositoryId,
      source_commit: source.commit ?? null,
      source_path: source.path,
      content_hash: source.contentHash ?? null,
      availability: source.availability,
      publication: source.publication,
      approval: source.approval,
      required_for: source.requiredFor,
      is_required: source.required,
      readable: source.readable,
      sections: source.sections,
    }));

    await withTransaction(async (client) => {
      await recordTransition(client, {
        transitionKey: manifest.snapshotId,
        projectId: manifest.projectId,
        unitId: manifest.unitId,
        event: {
          kind: "context.snapshot.preparing",
          metadata: { snapshotId: manifest.snapshotId, contextRevision: manifest.contextRevision },
        },
        queueIntents: [{
          intentKey: "retain-snapshot",
          queue: SNAPSHOT_RETENTION_QUEUE,
          payload: { snapshotId: manifest.snapshotId },
        }],
      }, async (tx) => {
        await tx.query(
          "insert into delivery.member_snapshot " +
            "(snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness, manifest, created_at, expires_at) " +
            "values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, clock_timestamp(), " +
            "clock_timestamp() + ($10::double precision * interval '1 millisecond'))",
          [
            manifest.snapshotId,
            manifest.projectId,
            manifest.unitId,
            manifest.activity,
            snapshot.requestedByUserId,
            manifest.contextRevision,
            JSON.stringify(snapshot.workItem),
            JSON.stringify(snapshot.readiness),
            JSON.stringify(manifest),
            snapshot.retentionMs,
          ],
        );
        await tx.query(
          "insert into delivery.member_snapshot_source " +
            "(snapshot_id, source_id, role, repository_id, source_commit, source_path, content_hash, availability, " +
            "publication, approval, required_for, is_required, readable, sections) " +
            "select $1, entry.source_id, entry.role, entry.repository_id, entry.source_commit, entry.source_path, " +
            "entry.content_hash, entry.availability, entry.publication, entry.approval, entry.required_for, " +
            "entry.is_required, entry.readable, entry.sections " +
            "from jsonb_to_recordset($2::jsonb) as entry(" +
            "source_id text, role text, repository_id text, source_commit text, source_path text, content_hash text, " +
            "availability text, publication text, approval text, required_for jsonb, is_required boolean, readable boolean, sections jsonb)",
          [manifest.snapshotId, JSON.stringify(sourceRows)],
        );
      });
    });
  }

  async get(snapshotId: string): Promise<SnapshotRecord | undefined> {
    const result = await getPool().query<SnapshotRow>(
      "select snapshot_id, requested_by_user_id, task, readiness, manifest, status, failure_code, created_at, expires_at " +
        "from delivery.member_snapshot where snapshot_id = $1",
      [snapshotId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      manifest: row.manifest,
      workItem: row.task,
      readiness: row.readiness,
      requestedByUserId: row.requested_by_user_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      ...(row.failure_code === null ? {} : { errorCode: row.failure_code }),
    };
  }

  async isAvailable(snapshotId: string): Promise<boolean> {
    const result = await getPool().query<{ available: boolean }>(
      "select status not in ('expired', 'expiring') and expires_at > clock_timestamp() as available " +
        "from delivery.member_snapshot where snapshot_id = $1",
      [snapshotId],
    );
    return result.rows[0]?.available === true;
  }

  async createCursor(cursor: SnapshotCursorInput): Promise<string> {
    const cursorId = randomUUID();
    await getPool().query(
      "insert into delivery.member_snapshot_cursor " +
        "(cursor_id, snapshot_id, cursor_kind, source_id, section_id, character_offset, query_hash, result_offset) " +
        "values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        cursorId,
        cursor.snapshotId,
        cursor.kind,
        cursor.sourceId ?? null,
        cursor.sectionId ?? null,
        cursor.characterOffset ?? null,
        cursor.queryHash ?? null,
        cursor.resultOffset ?? null,
      ],
    );
    return cursorId;
  }

  async getCursor(cursorId: string): Promise<SnapshotCursorRecord | undefined> {
    const result = await getPool().query<CursorRow>(
      "select cursor_id, snapshot_id, cursor_kind, source_id, section_id, character_offset, query_hash, result_offset " +
        "from delivery.member_snapshot_cursor where cursor_id = $1",
      [cursorId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      cursorId: row.cursor_id,
      snapshotId: row.snapshot_id,
      kind: row.cursor_kind,
      ...(row.source_id === null ? {} : { sourceId: row.source_id }),
      ...(row.section_id === null ? {} : { sectionId: row.section_id }),
      ...(row.character_offset === null ? {} : { characterOffset: row.character_offset }),
      ...(row.query_hash === null ? {} : { queryHash: row.query_hash }),
      ...(row.result_offset === null ? {} : { resultOffset: row.result_offset }),
    };
  }

  async acquireLease(snapshotId: string, purpose: string, ownerId: string, expiresAt?: string): Promise<void> {
    await withTransaction(async (client) => {
      const result = await client.query<{ status: SnapshotStatus }>(
        "select status from delivery.member_snapshot where snapshot_id = $1 for update",
        [snapshotId],
      );
      const snapshot = result.rows[0];
      if (snapshot === undefined || snapshot.status !== "ready") throw new SnapshotLeaseUnavailableError();
      const expiry = await client.query<{ is_unexpired: boolean }>(
        "select expires_at > clock_timestamp() as is_unexpired from delivery.member_snapshot where snapshot_id = $1",
        [snapshotId],
      );
      if (expiry.rows[0]?.is_unexpired !== true) throw new SnapshotLeaseUnavailableError();
      await client.query(
        "insert into delivery.member_snapshot_lease (lease_id, snapshot_id, purpose, owner_id, expires_at) " +
          "values ($1, $2, $3, $4, $5) on conflict (snapshot_id, purpose, owner_id) " +
          "do update set expires_at = excluded.expires_at",
        [randomUUID(), snapshotId, purpose, ownerId, expiresAt ?? null],
      );
    });
  }

  async releaseLease(snapshotId: string, purpose: string, ownerId: string): Promise<void> {
    await getPool().query(
      "delete from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = $2 and owner_id = $3",
      [snapshotId, purpose, ownerId],
    );
  }
}

export type { SnapshotSource };
