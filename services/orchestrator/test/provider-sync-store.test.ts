import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObservedPullRequest } from "@kintsugi/git";
import { PostgresProviderSyncStore } from "../src/provider-sync/inbox.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

describe.skipIf(!hasDatabase)("Postgres provider sync inbox (integration)", () => {
  let db: TestDatabase;
  let store: PostgresProviderSyncStore;

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PostgresProviderSyncStore(db.pool);
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('provider-sync', 'github', 'Provider sync', 'https://github.com', 'none')");
    await db.pool.query("insert into admin.git_repository (id, server_id, url) values ('provider-sync-repo', 'provider-sync', 'https://github.com/Acme/Provider-sync.git')");
  });

  afterAll(async () => db?.drop());

  it("holds one repository lease, resumes a saved cursor and acknowledges only the captured receipt snapshot", async () => {
    const initial = await store.watermark("provider-sync-repo");
    expect(initial.updatedAtWatermark).toBe("1970-01-01T00:00:00.000Z");
    let secondLease = true;
    const firstLease = await store.withRepositoryLock("provider-sync-repo", async () => {
      secondLease = await store.withRepositoryLock("provider-sync-repo", async () => undefined);
    });
    expect(firstLease).toBe(true);
    expect(secondLease).toBe(false);

    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, pull_request_number, payload, payload_sha256)
       values ('provider-sync', 'delivery-one', 'pull_request', 'provider-sync-repo',
               7, '{"providerRepositoryId":"42","providerPullRequestId":"87","repositoryPath":"Acme/Provider-sync","pullRequestNumber":7}', $1)`,
      ["a".repeat(64)],
    );
    expect(await store.deliveries("provider-sync-repo")).toEqual([{
      deliveryId: "delivery-one",
      providerRepositoryId: "42",
      providerPullRequestId: "87",
      pullRequestNumber: 7,
    }]);
    expect(await store.repositoriesToSync(20)).toContain("provider-sync-repo");
    await store.saveProgress("provider-sync-repo", {
      sweepMode: "deep",
      cursor: "https://api.github.com/repos/Acme/Provider-sync/pulls?state=all&page=2",
      startedAt: "2026-10-21T10:00:00.000Z",
      deepBackfillStartedAt: "2026-10-21T10:00:00.000Z",
    });
    expect(await store.watermark("provider-sync-repo")).toMatchObject({
      updatedAtWatermark: "1970-01-01T00:00:00.000Z",
      sweepMode: "deep",
      cursor: "https://api.github.com/repos/Acme/Provider-sync/pulls?state=all&page=2",
    });

    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, payload, payload_sha256)
       values ('provider-sync', 'delivery-two', 'pull_request', 'provider-sync-repo', '{"providerRepositoryId":"42"}', $1)`,
      ["b".repeat(64)],
    );
    await store.acknowledgeDeliveries("provider-sync-repo", ["delivery-one"]);
    await store.completeSweep("provider-sync-repo", {
      updatedAtWatermark: "2026-10-21T10:10:00.000Z",
      providerRepositoryId: "42",
      completedAt: "2026-10-21T10:15:00.000Z",
      lastDeepBackfillAt: "2026-10-21T10:15:00.000Z",
      nextPollAt: "2026-10-21T10:17:00.000Z",
      deliveryIds: [],
    });
    const deliveries = await db.pool.query<{ delivery_id: string; state: string }>(
      "select delivery_id, state from workflow.member_provider_delivery order by delivery_id",
    );
    expect(deliveries.rows).toEqual([
      { delivery_id: "delivery-one", state: "processed" },
      { delivery_id: "delivery-two", state: "pending" },
    ]);
    expect(await store.repositoriesToSync(20)).toContain("provider-sync-repo");
    const completed = await store.watermark("provider-sync-repo");
    expect(completed).toMatchObject({
      updatedAtWatermark: "2026-10-21T10:10:00.000Z",
      consecutiveFailures: 0,
    });
    expect(completed).not.toHaveProperty("cursor");
    expect(completed).not.toHaveProperty("sweepMode");
  });

  it("records a bounded failure and leaves a retryable receipt without advancing the completed watermark", async () => {
    await db.pool.query("insert into admin.git_repository (id, server_id, url) values ('provider-sync-retry', 'provider-sync', 'https://github.com/Acme/Provider-sync-retry.git')");
    await store.watermark("provider-sync-retry");
    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, payload, payload_sha256)
       values ('provider-sync', 'delivery-retry', 'pull_request', 'provider-sync-retry', '{}', $1)`,
      ["c".repeat(64)],
    );
    await store.failDeliveries("provider-sync-retry", ["delivery-retry"], "GITHUB_HTTP_429");
    await store.recordFailure("provider-sync-retry", {
      errorCode: "GITHUB_HTTP_429",
      nextPollAt: "2099-01-01T00:00:00.000Z",
    });

    const delivery = await db.pool.query<{ state: string; attempt_count: number; last_error: string }>(
      "select state, attempt_count, last_error from workflow.member_provider_delivery where delivery_id = 'delivery-retry'",
    );
    expect(delivery.rows[0]).toEqual({ state: "failed", attempt_count: 1, last_error: "GITHUB_HTTP_429" });
    expect(await store.watermark("provider-sync-retry")).toMatchObject({
      updatedAtWatermark: "1970-01-01T00:00:00.000Z",
      consecutiveFailures: 1,
    });
    expect(await store.repositoriesToSync(20)).not.toContain("provider-sync-retry");
  });

  it("persists current provider observations idempotently and rejects a stale overlap update", async () => {
    const current: ObservedPullRequest = {
      provider: "github",
      host: "github.com",
      repositoryId: "42",
      repositoryPath: "Acme/Provider-sync",
      pullRequestId: "87",
      number: 7,
      htmlUrl: "https://github.com/Acme/Provider-sync/pull/7",
      authorId: "9",
      authorLogin: "contributor",
      state: "open",
      draft: false,
      updatedAt: "2026-10-21T10:10:00.000Z",
      headSha: "a".repeat(40),
      headRef: "feature/change",
      baseSha: "b".repeat(40),
      baseRef: "main",
      reviews: [],
      checks: [],
    };
    await store.persistObservation("provider-sync-repo", current);
    await store.persistObservation("provider-sync-repo", { ...current, updatedAt: "2026-10-21T10:20:00.000Z", headSha: "c".repeat(40) });
    await store.persistObservation("provider-sync-repo", { ...current, updatedAt: "2026-10-21T10:15:00.000Z", headSha: "d".repeat(40) });

    const row = await db.pool.query<{ head_sha: string; provider_updated_at: Date }>(
      `select head_sha, provider_updated_at from workflow.member_provider_observation
        where repository_id = 'provider-sync-repo' and provider_pull_request_id = '87'`,
    );
    expect(row.rows[0]?.head_sha).toBe("c".repeat(40));
    expect(row.rows[0]?.provider_updated_at.toISOString()).toBe("2026-10-21T10:20:00.000Z");
  });
});
