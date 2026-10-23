import { GitHubAppError, type GitHubObservationConnection, type ObservedPullRequest, type PullRequestIdentity, type PullRequestObserver } from "@kintsugi/git";

export type ProviderSweepMode = "incremental" | "deep";

export interface ProviderWatermark {
  updatedAtWatermark: string;
  providerRepositoryId?: string;
  cursor?: string;
  sweepMode?: ProviderSweepMode;
  deepBackfillStartedAt?: string;
  lastDeepBackfillAt?: string;
  nextPollAt?: string;
  consecutiveFailures: number;
}

export interface ProviderSyncDelivery {
  deliveryId: string;
  providerRepositoryId?: string;
  providerPullRequestId?: string;
  pullRequestNumber?: number;
}

export interface ProviderSyncStore {
  withRepositoryLock(repositoryId: string, work: () => Promise<void>): Promise<boolean>;
  watermark(repositoryId: string): Promise<ProviderWatermark>;
  deliveries(repositoryId: string): Promise<ProviderSyncDelivery[]>;
  acknowledgeDeliveries(repositoryId: string, deliveryIds: string[]): Promise<void>;
  saveProgress(repositoryId: string, progress: {
    sweepMode: ProviderSweepMode;
    cursor?: string;
    startedAt: string;
    deepBackfillStartedAt?: string;
  }): Promise<void>;
  persistObservation(repositoryId: string, pullRequest: ObservedPullRequest): Promise<void>;
  reconcileAssociations(repositoryId: string): Promise<void>;
  completeSweep(repositoryId: string, completed: {
    updatedAtWatermark: string;
    providerRepositoryId?: string;
    completedAt: string;
    lastDeepBackfillAt?: string;
    nextPollAt: string;
    deliveryIds: string[];
  }): Promise<void>;
  recordFailure(repositoryId: string, failure: { errorCode: string; nextPollAt: string }): Promise<void>;
  failDeliveries(repositoryId: string, deliveryIds: string[], errorCode: string): Promise<void>;
}

export interface ProviderSyncDependencies {
  store: ProviderSyncStore;
  connections: { githubProviderConnection(repositoryId: string): Promise<GitHubObservationConnection | undefined> };
  observer: Pick<PullRequestObserver<GitHubObservationConnection>, "listChanged" | "get"> & {
    listAll(connection: GitHubObservationConnection, cursor?: string): ReturnType<PullRequestObserver<GitHubObservationConnection>["listChanged"]>;
  };
  now?: () => Date;
  random?: () => number;
  pollIntervalSeconds?: number;
  overlapSeconds?: number;
  deepBackfillSeconds?: number;
  maxPagesPerSweep?: number;
}

export type SweepResult =
  | { status: "busy"; pages: 0; processed: 0 }
  | { status: "partial"; pages: number; processed: number }
  | { status: "complete"; pages: number; processed: number }
  | { status: "failed"; pages: number; processed: number; errorCode: string }
  | { status: "unavailable"; pages: 0; processed: 0 };

const EPOCH = "1970-01-01T00:00:00.000Z";
const DEFAULT_POLL_SECONDS = 120;
const DEFAULT_OVERLAP_SECONDS = 10 * 60;
const DEFAULT_DEEP_BACKFILL_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_PAGES = 100;

const timeValue = (value: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new GitHubAppError("PROVIDER_WATERMARK_INVALID", "Provider synchronization watermark is invalid");
  return timestamp;
};

function maxTime(left: string, right: string): string {
  return timeValue(left) >= timeValue(right) ? left : right;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : "PROVIDER_SYNC_FAILED";
}

function retryAfterMs(error: unknown): number {
  const retry = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? Math.min(retry, 24 * 60 * 60 * 1000) : 0;
}

export function providerRetryDelayMs(failures: number, providerDelayMs = 0, random = Math.random): number {
  const exponent = Math.min(10, Math.max(0, Math.trunc(failures)));
  const base = Math.min(30 * 60 * 1000, 15_000 * 2 ** exponent);
  const jitter = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.min(24 * 60 * 60 * 1000, Math.max(Math.round(base * jitter), providerDelayMs));
}

/** Fetches current provider state; webhook metadata is never used as a review verdict. */
export async function reconcilePullRequest(
  deps: Pick<ProviderSyncDependencies, "observer" | "store">,
  repositoryId: string,
  connection: GitHubObservationConnection,
  identity: PullRequestIdentity,
): Promise<ObservedPullRequest> {
  const current = await deps.observer.get(connection, identity);
  await deps.store.persistObservation(repositoryId, current);
  return current;
}

/** A serialized, durable all-state sweep. A saved cursor never advances the completed watermark. */
export async function discoverChanges(deps: ProviderSyncDependencies, repositoryId: string): Promise<SweepResult> {
  const now = deps.now ?? (() => new Date());
  const pollSeconds = deps.pollIntervalSeconds ?? DEFAULT_POLL_SECONDS;
  const overlapSeconds = deps.overlapSeconds ?? DEFAULT_OVERLAP_SECONDS;
  const deepSeconds = deps.deepBackfillSeconds ?? DEFAULT_DEEP_BACKFILL_SECONDS;
  const maxPages = deps.maxPagesPerSweep ?? DEFAULT_MAX_PAGES;
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || !Number.isInteger(overlapSeconds) || overlapSeconds < 0 ||
      !Number.isInteger(deepSeconds) || deepSeconds < 1 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) {
    throw new RangeError("provider sync intervals and page limit are invalid");
  }

  let pages = 0;
  let processed = 0;
  let watermark: ProviderWatermark | undefined;
  let pendingDeliveryIds: string[] = [];
  let pendingDeliveries: ProviderSyncDelivery[] = [];
  let result: SweepResult = { status: "unavailable", pages: 0, processed: 0 };
  let failed: unknown;

  try {
    const acquired = await deps.store.withRepositoryLock(repositoryId, async () => {
      watermark = await deps.store.watermark(repositoryId);
      pendingDeliveries = await deps.store.deliveries(repositoryId);
      pendingDeliveryIds = pendingDeliveries.map((delivery) => delivery.deliveryId);
      const connection = await deps.connections.githubProviderConnection(repositoryId);
      if (connection === undefined) {
        throw new GitHubAppError("GITHUB_CONNECTION_UNAVAILABLE", "GitHub repository credentials are not configured");
      }
      let highWatermark = watermark.updatedAtWatermark;
      let providerRepositoryId = watermark.providerRepositoryId;
      const targetedDeliveryIds: string[] = [];
      const targetedPullRequests = new Set<string>();
      const targetedUpdatedAt = new Map<string, string>();
      const host = new URL(connection.baseUrl).hostname.toLowerCase();
      for (const delivery of pendingDeliveries) {
        if (delivery.providerRepositoryId === undefined || delivery.providerPullRequestId === undefined || delivery.pullRequestNumber === undefined) continue;
        const key = [host, delivery.providerRepositoryId, delivery.providerPullRequestId].join("/");
        if (!targetedPullRequests.has(key)) {
          targetedPullRequests.add(key);
          const current = await reconcilePullRequest(deps, repositoryId, connection, {
            host,
            repositoryId: delivery.providerRepositoryId,
            repositoryPath: connection.repositoryPath,
            pullRequestId: delivery.providerPullRequestId,
            number: delivery.pullRequestNumber,
          });
          processed += 1;
          providerRepositoryId = current.repositoryId;
          highWatermark = maxTime(highWatermark, current.updatedAt);
          targetedUpdatedAt.set(key, current.updatedAt);
        }
        targetedDeliveryIds.push(delivery.deliveryId);
      }
      if (targetedDeliveryIds.length > 0) {
        await deps.store.acknowledgeDeliveries(repositoryId, targetedDeliveryIds);
        const acknowledged = new Set(targetedDeliveryIds);
        pendingDeliveryIds = pendingDeliveryIds.filter((deliveryId) => !acknowledged.has(deliveryId));
      }
      const startedAt = now().toISOString();
      const deepDue = watermark.lastDeepBackfillAt === undefined ||
        timeValue(startedAt) - timeValue(watermark.lastDeepBackfillAt) >= deepSeconds * 1000;
      const mode: ProviderSweepMode = watermark.sweepMode ?? (deepDue ? "deep" : "incremental");
      const deepStartedAt = mode === "deep" ? watermark.deepBackfillStartedAt ?? startedAt : undefined;
      const scanWatermark = mode === "deep"
        ? EPOCH
        : new Date(Math.max(0, timeValue(watermark.updatedAtWatermark) - overlapSeconds * 1000)).toISOString();
      let cursor = watermark.sweepMode === mode ? watermark.cursor : undefined;
      if (watermark.sweepMode !== mode || cursor === undefined) {
        await deps.store.saveProgress(repositoryId, {
          sweepMode: mode,
          ...(cursor === undefined ? {} : { cursor }),
          startedAt,
          ...(deepStartedAt === undefined ? {} : { deepBackfillStartedAt: deepStartedAt }),
        });
      }

      const seen = new Set<string>();
      result = { status: "partial", pages: 0, processed: 0 };
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
        const page = mode === "deep"
          ? await deps.observer.listAll(connection, cursor)
          : await deps.observer.listChanged(connection, scanWatermark, cursor);
        if (page.complete && page.nextCursor !== undefined) {
          throw new GitHubAppError("GITHUB_PAGINATION_INVALID", "GitHub marked a page complete while returning a next cursor");
        }
        if (!page.complete && page.nextCursor === undefined) {
          throw new GitHubAppError("GITHUB_PAGINATION_INVALID", "GitHub did not return a cursor for an incomplete page");
        }
        for (const item of page.items) {
          const identityKey = [item.host.toLowerCase(), item.repositoryId, item.pullRequestId].join("/");
          if (seen.has(identityKey)) continue;
          seen.add(identityKey);
          const targetedRevision = targetedUpdatedAt.get(identityKey);
          if (targetedRevision !== undefined && timeValue(item.updatedAt) <= timeValue(targetedRevision)) continue;
          const current = await reconcilePullRequest(deps, repositoryId, connection, item);
          processed += 1;
          providerRepositoryId = current.repositoryId;
          highWatermark = maxTime(highWatermark, current.updatedAt);
          targetedUpdatedAt.set(identityKey, current.updatedAt);
        }
        highWatermark = maxTime(highWatermark, page.latestUpdatedAt);
        pages += 1;
        cursor = page.nextCursor;
        if (page.complete) {
          const completedAt = now().toISOString();
          const updatedAtWatermark = maxTime(watermark.updatedAtWatermark, highWatermark);
          await deps.store.reconcileAssociations(repositoryId);
          await deps.store.completeSweep(repositoryId, {
            updatedAtWatermark,
            ...(providerRepositoryId === undefined ? {} : { providerRepositoryId }),
            completedAt,
            ...(mode === "deep" ? { lastDeepBackfillAt: completedAt } : {}),
            nextPollAt: new Date(timeValue(completedAt) + pollSeconds * 1000).toISOString(),
            deliveryIds: pendingDeliveryIds,
          });
          result = { status: "complete", pages, processed };
          return;
        }
        await deps.store.saveProgress(repositoryId, {
          sweepMode: mode,
          cursor,
          startedAt,
          ...(deepStartedAt === undefined ? {} : { deepBackfillStartedAt: deepStartedAt }),
        });
      }
      result = { status: "partial", pages, processed };
    });
    if (!acquired) return { status: "busy", pages: 0, processed: 0 };
    return result;
  } catch (error) {
    failed = error;
  }

  const code = errorCode(failed);
  const failedAt = now();
  const delay = providerRetryDelayMs(watermark?.consecutiveFailures ?? 0, retryAfterMs(failed), deps.random);
  await Promise.all([
    deps.store.recordFailure(repositoryId, { errorCode: code, nextPollAt: new Date(failedAt.getTime() + delay).toISOString() }),
    deps.store.failDeliveries(repositoryId, pendingDeliveryIds, code),
  ]);
  return { status: "failed", pages, processed, errorCode: code };
}
