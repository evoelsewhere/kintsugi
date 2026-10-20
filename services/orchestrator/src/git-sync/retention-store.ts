// PostgreSQL adapter used only by the worker to retain and expire snapshot refs.

import type { Pool } from "pg";
import type {
  SnapshotLease,
  SnapshotRepositoryPin,
  SnapshotRetentionRecord,
  SnapshotRetentionRepository,
} from "./retention.js";

interface SnapshotRow {
  snapshot_id: string;
  status: SnapshotRetentionRecord["status"];
  expires_at: Date;
  failure_code: string | null;
}

interface RepositoryPinRow {
  repository_id: string;
  source_commit: string;
}

interface LeaseRow {
  expires_at: Date | null;
}

export class PostgresSnapshotRetentionRepository implements SnapshotRetentionRepository {
  constructor(private readonly pool: Pool) {}

  async get(snapshotId: string): Promise<SnapshotRetentionRecord | undefined> {
    const result = await this.pool.query<SnapshotRow>(
      "select snapshot_id, status, expires_at, failure_code from delivery.member_snapshot where snapshot_id = $1",
      [snapshotId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const [pins, leases] = await Promise.all([
      this.pool.query<RepositoryPinRow>(
        "select distinct repository_id, source_commit from delivery.member_snapshot_source " +
          "where snapshot_id = $1 and source_commit is not null order by repository_id, source_commit",
        [snapshotId],
      ),
      this.pool.query<LeaseRow>(
        "select expires_at from delivery.member_snapshot_lease where snapshot_id = $1",
        [snapshotId],
      ),
    ]);
    return {
      snapshotId: row.snapshot_id,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      repositories: pins.rows.map((pin): SnapshotRepositoryPin => ({ repositoryId: pin.repository_id, commit: pin.source_commit })),
      leases: leases.rows.map((lease): SnapshotLease => ({ expiresAt: lease.expires_at?.toISOString() ?? null })),
      ...(row.failure_code === null ? {} : { errorCode: row.failure_code }),
    };
  }

  async listExpired(now: Date): Promise<SnapshotRetentionRecord[]> {
    const result = await this.pool.query<{ snapshot_id: string }>(
      "select snapshot_id from delivery.member_snapshot where status = 'ready' and expires_at <= $1 " +
        "order by expires_at, snapshot_id limit 100",
      [now],
    );
    const records = await Promise.all(result.rows.map((row) => this.get(row.snapshot_id)));
    return records.filter((record): record is SnapshotRetentionRecord => record !== undefined);
  }

  async markReady(snapshotId: string): Promise<void> {
    await this.pool.query(
      "update delivery.member_snapshot set status = 'ready', pin_state = 'retained', ready_at = now(), failure_code = null " +
        "where snapshot_id = $1 and status = 'preparing'",
      [snapshotId],
    );
  }

  async markFailed(snapshotId: string, code: string): Promise<void> {
    await this.pool.query(
      "update delivery.member_snapshot set status = 'failed', pin_state = 'failed', failure_code = $2 " +
        "where snapshot_id = $1 and status = 'preparing'",
      [snapshotId, code],
    );
  }

  async markExpired(snapshotId: string): Promise<void> {
    await this.pool.query(
      "update delivery.member_snapshot set status = 'expired', pin_state = 'released', expired_at = now() " +
        "where snapshot_id = $1 and status = 'ready' and expires_at <= now()",
      [snapshotId],
    );
    await this.pool.query("delete from delivery.member_snapshot_cursor where snapshot_id = $1", [snapshotId]);
  }
}
