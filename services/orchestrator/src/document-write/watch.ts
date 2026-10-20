// The review watch (ADR-0019): a write that went to a `kintsugi/*` branch waits for a person to merge
// it. The worker looks at those writes on a timer and records how each ended — `merged` (its
// commit is on the default branch, or the server says the pull request was merged: squash and
// rebase merges leave no ancestry) or `closed` (declined or abandoned). A write with no pull
// request (plain-git, SSH-only servers) can only be seen through ancestry.

import { repositoryPath } from "@kintsugi/domain";
import { CheckoutStorage, isAncestor, type PullRequestServerKind, pullRequestProvider } from "@kintsugi/git";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { syncRepository } from "../git-sync/sync.js";
import type { AwaitingReview, DocumentWriteStore } from "./store.js";
import { mirrorDefaultBranch } from "./writer.js";

export interface WatchDeps {
  writes: DocumentWriteStore;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  /** For tests: the HTTP client of the pull-request adapters. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface WatchResult {
  checked: number;
  merged: string[];
  closed: string[];
}

/** Most writes looked at in one pass, newest first: an old forgotten pull request never starves the new ones. */
const BATCH = 100;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One pass over the writes that still wait for a review outcome. Never throws for one project's failure. */
export async function watchPullRequests(deps: WatchDeps): Promise<WatchResult> {
  const log = deps.log ?? (() => undefined);
  const result: WatchResult = { checked: 0, merged: [], closed: [] };
  const awaiting = await deps.writes.awaitingReview(BATCH);
  const byProject = new Map<string, AwaitingReview[]>();
  for (const write of awaiting) byProject.set(write.projectId, [...(byProject.get(write.projectId) ?? []), write]);

  for (const [projectId, writes] of byProject) {
    try {
      const target = await deps.writes.target(projectId);
      if (target === undefined) continue;
      const { repository } = target;
      // A fresh mirror shows a merge the server did since the last poll.
      await syncRepository({ store: deps.repositories, storage: deps.storage }, repository.id);
      const mirror = deps.storage.mirror(repository.serverId, repository.id);
      const defaultBranch = repository.defaultBranch ?? (await mirrorDefaultBranch(mirror));
      const provider = pullRequestProvider(target.serverKind as PullRequestServerKind, deps.fetch);

      for (const write of writes) {
        result.checked += 1;
        let outcome: "merged" | "closed" | undefined;
        if (write.branchCommit !== undefined && (await isAncestor(mirror, write.branchCommit, `refs/heads/${defaultBranch}`).catch(() => false))) {
          outcome = "merged";
        } else if (write.prUrl !== undefined && provider !== undefined && target.apiToken !== undefined) {
          try {
            const state = await provider.state({ baseUrl: target.serverBaseUrl, path: repositoryPath(repository.url, target.serverBaseUrl), token: target.apiToken, url: write.prUrl });
            if (state === "merged" || state === "closed") outcome = state;
          } catch (error) {
            // The token is redacted by the adapter; one failing pull request does not stop the others.
            log(`pull request of write ${write.id}: could not read its state: ${messageOf(error).slice(0, 300)}`);
          }
        }
        if (outcome === undefined) continue;
        if (await deps.writes.markReviewOutcome(write.id, outcome)) {
          result[outcome].push(write.id);
          log(`write ${write.id} (${projectId}): review ${outcome}`);
        }
      }
    } catch (error) {
      log(`review watch of project ${projectId} failed: ${messageOf(error).slice(0, 300)}`);
    }
  }
  return result;
}
