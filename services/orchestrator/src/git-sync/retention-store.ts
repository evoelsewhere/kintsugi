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

  async withSnapshotLock<T>(snapshotId: string, work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const lockKey = "kintsugi.snapshot-retention:" + snapshotId;
    try {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      return await work();
    } finally {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]).catch(() => undefined);
      client.release();
    }
  }

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

  async claimExpired(): Promise<{ snapshots: SnapshotRetentionRecord[]; retained: number }> {
    const client = await this.pool.connect();
    const claimedIds: string[] = [];
    let retained = 0;
    try {
      await client.query("begin");
      const candidates = await client.query<SnapshotRow>(
        "select snapshot_id, status, expires_at, failure_code from delivery.member_snapshot " +
        "where status in ('ready', 'expiring') and expires_at <= clock_timestamp() " +
          "order by expires_at, snapshot_id limit 100 for update skip locked",
      );
      for (const candidate of candidates.rows) {
        if (candidate.status === "ready") {
          const activeLease = await client.query<{ present: boolean }>(
            "select exists (select 1 from delivery.member_snapshot_lease " +
              "where snapshot_id = $1 and (expires_at is null or expires_at > clock_timestamp())) as present",
            [candidate.snapshot_id],
          );
          if (activeLease.rows[0]?.present === true) {
            retained += 1;
            continue;
          }
          await client.query(
            "update delivery.member_snapshot set status = 'expiring', pin_state = 'releasing', ready_at = null " +
              "where snapshot_id = $1 and status = 'ready'",
            [candidate.snapshot_id],
          );
        }
        claimedIds.push(candidate.snapshot_id);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const snapshots = await Promise.all(claimedIds.map((snapshotId) => this.get(snapshotId)));
    return {
      snapshots: snapshots.filter((record): record is SnapshotRetentionRecord => record !== undefined),
      retained,
    };
  }

  async claimStalePreparing(): Promise<SnapshotRetentionRecord[]> {
    const client = await this.pool.connect();
    const claimedIds: string[] = [];
    try {
      await client.query("begin");
      const candidates = await client.query<{ snapshot_id: string }>(
        "select snapshot_id from delivery.member_snapshot " +
          "where status = 'preparing' and created_at <= clock_timestamp() - interval '5 minutes' and " +
          "(retention_checked_at is null or retention_checked_at <= clock_timestamp() - interval '5 minutes') " +
          "order by created_at, snapshot_id limit 100 for update skip locked",
      );
      for (const candidate of candidates.rows) {
        await client.query(
          "update delivery.member_snapshot set retention_checked_at = clock_timestamp() " +
            "where snapshot_id = $1 and status = 'preparing'",
          [candidate.snapshot_id],
        );
        claimedIds.push(candidate.snapshot_id);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const snapshots = await Promise.all(claimedIds.map((snapshotId) => this.get(snapshotId)));
    return snapshots.filter((record): record is SnapshotRetentionRecord => record !== undefined);
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        "update delivery.member_snapshot set status = 'expired', pin_state = 'released', expired_at = clock_timestamp() " +
          "where snapshot_id = $1 and status = 'expiring' and expires_at <= clock_timestamp()",
        [snapshotId],
      );
      if ((result.rowCount ?? 0) > 0) {
        await client.query("delete from delivery.member_snapshot_cursor where snapshot_id = $1", [snapshotId]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
