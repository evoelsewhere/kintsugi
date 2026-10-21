import type {
  GitHubObservationConnection,
  ObservedPullRequest,
  ObservedPullRequestSummary,
  PullRequestObserver,
} from "@kintsugi/git";
import { describe, expect, it, vi } from "vitest";
import { discoverChanges, type ProviderSyncDelivery, type ProviderSyncStore, type ProviderWatermark } from "../src/provider-sync/reconcile.js";

const NOW = "2026-10-21T10:20:00.000Z";
const SHA = "a".repeat(40);
const connection: GitHubObservationConnection = {
  kind: "github",
  baseUrl: "https://github.com",
  repositoryPath: "Acme/Billing",
  token: "TEST-token",
};

function pull(overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest {
  return {
    provider: "github",
    host: "github.com",
    repositoryId: "42",
    repositoryPath: "Acme/Billing",
    pullRequestId: "87",
    number: 12,
    htmlUrl: "https://github.com/Acme/Billing/pull/12",
    authorId: "9",
    authorLogin: "dev",
    state: "merged",
    draft: false,
    updatedAt: "2026-10-21T10:10:00.000Z",
    headSha: SHA,
    headRef: "feature/change",
    baseSha: SHA,
    baseRef: "main",
    mergeCommitSha: SHA,
    mergedAt: "2026-10-21T10:11:00.000Z",
    reviews: [],
    checks: [],
    ...overrides,
  };
}

function summary(value: ObservedPullRequest = pull()): ObservedPullRequestSummary {
  const { reviews: _reviews, checks: _checks, ...rest } = value;
  return rest;
}

function harness(options: {
  watermark?: Partial<ProviderWatermark>;
  pending?: ProviderSyncDelivery[];
  changedPages?: Array<ReturnType<typeof page>>;
  deepPages?: Array<ReturnType<typeof page>>;
  current?: ObservedPullRequest;
  failPage?: number;
  maxPagesPerSweep?: number;
  connectionMissing?: boolean;
} = {}) {
  const state: ProviderWatermark = {
    updatedAtWatermark: "2026-10-21T10:00:00.000Z",
    lastDeepBackfillAt: "2026-10-21T09:30:00.000Z",
    consecutiveFailures: 0,
    ...options.watermark,
  };
  let locked = false;
  const store = {
    withRepositoryLock: vi.fn(async (_repositoryId: string, work: () => Promise<void>) => {
      if (locked) return false;
      locked = true;
      try { await work(); } finally { locked = false; }
      return true;
    }),
    watermark: vi.fn(async () => ({ ...state })),
    deliveries: vi.fn(async () => options.pending ?? []),
    acknowledgeDeliveries: vi.fn(async () => undefined),
    saveProgress: vi.fn(async (_repositoryId: string, progress: Parameters<ProviderSyncStore["saveProgress"]>[1]) => {
      state.sweepMode = progress.sweepMode;
      state.cursor = progress.cursor;
      state.deepBackfillStartedAt = progress.deepBackfillStartedAt;
    }),
    persistObservation: vi.fn(async () => undefined),
    completeSweep: vi.fn(async (_repositoryId: string, completed: Parameters<ProviderSyncStore["completeSweep"]>[1]) => {
      state.updatedAtWatermark = completed.updatedAtWatermark;
      state.sweepMode = undefined;
      state.cursor = undefined;
      state.deepBackfillStartedAt = undefined;
      if (completed.lastDeepBackfillAt !== undefined) state.lastDeepBackfillAt = completed.lastDeepBackfillAt;
      state.consecutiveFailures = 0;
    }),
    recordFailure: vi.fn(async (_repositoryId: string, failure: Parameters<ProviderSyncStore["recordFailure"]>[1]) => {
      state.consecutiveFailures += 1;
      state.nextPollAt = failure.nextPollAt;
    }),
    failDeliveries: vi.fn(async () => undefined),
  } as unknown as ProviderSyncStore;
  const changedPages = options.changedPages ?? [page([summary(options.current ?? pull({ state: "open", mergedAt: undefined, mergeCommitSha: undefined }))])];
  const deepPages = options.deepPages ?? [page([summary(options.current ?? pull())])];
  let changedIndex = 0;
  let deepIndex = 0;
  const observer = {
    listChanged: vi.fn(async (_connection: GitHubObservationConnection, _watermark: string, cursor?: string) => {
      const index = cursor === undefined ? changedIndex++ : changedIndex++;
      if (options.failPage === index) throw Object.assign(new Error("rate limited"), { code: "GITHUB_HTTP_429", retryAfterMs: 60_000 });
      return changedPages[index] ?? page([], true);
    }),
    listAll: vi.fn(async (_connection: GitHubObservationConnection, cursor?: string) => {
      const index = cursor === undefined ? deepIndex++ : deepIndex++;
      if (options.failPage === index) throw Object.assign(new Error("rate limited"), { code: "GITHUB_HTTP_429", retryAfterMs: 60_000 });
      return deepPages[index] ?? page([], true);
    }),
    get: vi.fn(async () => options.current ?? pull()),
  } as unknown as PullRequestObserver<GitHubObservationConnection> & { listAll(connection: GitHubObservationConnection, cursor?: string): Promise<ReturnType<typeof page>> };
  const dependencies = {
    store,
    connections: { githubProviderConnection: vi.fn(async () => options.connectionMissing ? undefined : connection) },
    observer,
    now: () => new Date(NOW),
    random: () => 0.5,
    maxPagesPerSweep: options.maxPagesPerSweep ?? 1,
  };
  return { dependencies, store, observer, state };
}

function page(items: ObservedPullRequestSummary[], complete = true, nextCursor?: string) {
  return {
    items,
    latestUpdatedAt: items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, "1970-01-01T00:00:00.000Z"),
    complete,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

describe("provider pull-request reconciliation", () => {
  it("uses the provider's current state when webhook deliveries arrive out of order", async () => {
    const current = pull({ state: "merged", updatedAt: "2026-10-21T10:10:00.000Z" });
    const { dependencies, store, observer } = harness({
      current,
      pending: [
        { deliveryId: "delivery-open", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 },
        { deliveryId: "delivery-merged", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 },
      ],
    });
    const result = await discoverChanges(dependencies, "billing");

    expect(result).toMatchObject({ status: "complete", processed: 1 });
    expect(observer.get).toHaveBeenCalledWith(connection, expect.objectContaining({ number: 12 }));
    expect(store.persistObservation).toHaveBeenCalledWith("billing", current);
    expect(vi.mocked(observer.get).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(observer.listChanged).mock.invocationCallOrder[0]!);
    expect(store.acknowledgeDeliveries).toHaveBeenCalledWith("billing", ["delivery-open", "delivery-merged"]);
    expect(store.completeSweep).toHaveBeenCalledWith("billing", expect.objectContaining({ deliveryIds: [] }));
  });

  it("reconciles and acknowledges an exact PR hint before a multi-page recovery sweep finishes", async () => {
    const { dependencies, store, observer, state } = harness({
      pending: [{ deliveryId: "delivery-fast", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 }],
      watermark: { lastDeepBackfillAt: "2026-10-18T10:00:00.000Z" },
      deepPages: [page([summary()], false, "cursor-2")],
    });

    const result = await discoverChanges(dependencies, "billing");

    expect(result.status).toBe("partial");
    expect(observer.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(observer.get).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(observer.listAll).mock.invocationCallOrder[0]!);
    expect(store.acknowledgeDeliveries).toHaveBeenCalledWith("billing", ["delivery-fast"]);
    expect(store.completeSweep).not.toHaveBeenCalled();
    expect(state.updatedAtWatermark).toBe("2026-10-21T10:00:00.000Z");
  });

  it("keeps the targeted PR observation acknowledged when a later broad page fails", async () => {
    const { dependencies, store, state } = harness({
      pending: [{ deliveryId: "delivery-fast", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 }],
      watermark: { lastDeepBackfillAt: "2026-10-18T10:00:00.000Z" },
      failPage: 0,
    });

    const result = await discoverChanges(dependencies, "billing");

    expect(result).toMatchObject({ status: "failed", errorCode: "GITHUB_HTTP_429" });
    expect(store.acknowledgeDeliveries).toHaveBeenCalledWith("billing", ["delivery-fast"]);
    expect(store.failDeliveries).toHaveBeenCalledWith("billing", [], "GITHUB_HTTP_429");
    expect(store.completeSweep).not.toHaveBeenCalled();
    expect(state.updatedAtWatermark).toBe("2026-10-21T10:00:00.000Z");
  });

  it("retries a durable receipt after a crash between observation persistence and acknowledgement", async () => {
    const { dependencies, store, observer } = harness({
      pending: [{ deliveryId: "delivery-crash", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 }],
    });
    const acknowledge = vi.mocked(store.acknowledgeDeliveries);
    acknowledge.mockRejectedValueOnce(new Error("simulated crash boundary"));

    await expect(discoverChanges(dependencies, "billing")).resolves.toMatchObject({ status: "failed" });
    expect(store.persistObservation).toHaveBeenCalledTimes(1);
    expect(store.failDeliveries).toHaveBeenCalledWith("billing", ["delivery-crash"], "PROVIDER_SYNC_FAILED");

    await expect(discoverChanges(dependencies, "billing")).resolves.toMatchObject({ status: "complete" });
    expect(observer.get).toHaveBeenCalledTimes(2);
    expect(store.persistObservation).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenLastCalledWith("billing", ["delivery-crash"]);
  });

  it("finds a pull request opened and merged while Kintsugi was offline through a deep all-state backfill", async () => {
    const current = pull({ state: "merged", updatedAt: "2026-10-21T10:10:00.000Z" });
    const { dependencies, store, observer } = harness({
      current,
      watermark: { updatedAtWatermark: "2026-10-18T10:00:00.000Z", lastDeepBackfillAt: "2026-10-18T10:00:00.000Z" },
    });
    const result = await discoverChanges(dependencies, "billing");

    expect(observer.listAll).toHaveBeenCalledWith(connection, undefined);
    expect(observer.get).toHaveBeenCalledTimes(1);
    expect(store.persistObservation).toHaveBeenCalledWith("billing", current);
    expect(store.completeSweep).toHaveBeenCalledWith("billing", expect.objectContaining({
      updatedAtWatermark: current.updatedAt,
      lastDeepBackfillAt: NOW,
    }));
    expect(result.status).toBe("complete");
  });

  it("keeps the watermark fixed across an incomplete page and resumes from its durable cursor", async () => {
    const { dependencies, store, observer, state } = harness({
      watermark: { lastDeepBackfillAt: "2026-10-18T10:00:00.000Z" },
      deepPages: [page([summary()], false, "cursor-2"), page([summary(pull({ pullRequestId: "88", number: 13 }))], true)],
    });
    const first = await discoverChanges(dependencies, "billing");
    expect(first).toMatchObject({ status: "partial" });
    expect(state.updatedAtWatermark).toBe("2026-10-21T10:00:00.000Z");
    expect(state.cursor).toBe("cursor-2");
    expect(store.completeSweep).not.toHaveBeenCalled();

    const second = await discoverChanges(dependencies, "billing");
    expect(second.status).toBe("complete");
    expect(observer.listAll).toHaveBeenLastCalledWith(connection, "cursor-2");
    expect(store.completeSweep).toHaveBeenCalledTimes(1);
  });

  it("does not advance the watermark or acknowledge receipts after a page failure", async () => {
    const { dependencies, store, state } = harness({
      pending: [{ deliveryId: "delivery-1" }],
      watermark: { lastDeepBackfillAt: "2026-10-18T10:00:00.000Z" },
      deepPages: [page([summary()], false, "cursor-2")],
      failPage: 1,
      maxPagesPerSweep: 2,
    });
    const result = await discoverChanges(dependencies, "billing");
    expect(result.status).toBe("failed");
    expect(state.updatedAtWatermark).toBe("2026-10-21T10:00:00.000Z");
    expect(state.cursor).toBe("cursor-2");
    expect(store.completeSweep).not.toHaveBeenCalled();
    expect(store.failDeliveries).toHaveBeenCalledWith("billing", ["delivery-1"], "GITHUB_HTTP_429");
    expect(store.recordFailure).toHaveBeenCalledWith("billing", expect.objectContaining({
      errorCode: "GITHUB_HTTP_429",
      nextPollAt: "2026-10-21T10:21:00.000Z",
    }));
  });

  it("skips a repository already being reconciled by another worker", async () => {
    const { dependencies, observer } = harness();
    const store = dependencies.store as unknown as { withRepositoryLock: ReturnType<typeof vi.fn> };
    store.withRepositoryLock.mockResolvedValue(false);
    await expect(discoverChanges(dependencies, "billing")).resolves.toMatchObject({ status: "busy" });
    expect(observer.listChanged).not.toHaveBeenCalled();
  });

  it("backs off when repository credentials are missing and keeps captured deliveries retryable", async () => {
    const { dependencies, store, state } = harness({
      connectionMissing: true,
      pending: [{ deliveryId: "delivery-missing-key", providerRepositoryId: "42", providerPullRequestId: "87", pullRequestNumber: 12 }],
    });

    const result = await discoverChanges(dependencies, "billing");

    expect(result).toMatchObject({ status: "failed", errorCode: "GITHUB_CONNECTION_UNAVAILABLE" });
    expect(state.consecutiveFailures).toBe(1);
    expect(state.nextPollAt).toBe("2026-10-21T10:20:15.000Z");
    expect(store.failDeliveries).toHaveBeenCalledWith("billing", ["delivery-missing-key"], "GITHUB_CONNECTION_UNAVAILABLE");
  });
});
