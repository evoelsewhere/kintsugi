// The review watch (ADR-0019): a write that went to a `kintsugi/*` branch waits for a person to merge
// it. The worker looks at those writes on a timer and records how each ended — `merged` (its
// commit is on the default branch, or the server says the pull request was merged: squash and
// rebase merges leave no ancestry) or `closed` (declined or abandoned). A write with no pull
// request (plain-git, SSH-only servers) can only be seen through ancestry.

import { repositoryPath } from "@kintsugi/domain";
import { CheckoutStorage, isAncestor, type PullRequestServerKind, pullRequestProvider, runGit } from "@kintsugi/git";
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

/**
 * The commit that brought `branchCommit` into the default branch, so the history of a file reaches the write that made it:
 * the branch's own tip when the default branch fast-forwarded to it, else the oldest commit of the default branch's first
 * parents that has it as an ancestor (the merge commit). Undefined when the branch was squashed or rebased in, which leaves
 * no ancestry to read.
 */
export async function mergeCommitOf(mirror: string, branchCommit: string, defaultBranch: string): Promise<string | undefined> {
  const ref = `refs/heads/${defaultBranch}`;
  if (!(await isAncestor(mirror, branchCommit, ref).catch(() => false))) return undefined;
  const firstParents = (await runGit(["--git-dir", mirror, "rev-list", "--first-parent", ref]).then((result) => result.stdout, () => "")).split("\n");
  if (firstParents.includes(branchCommit)) return branchCommit;
  const path = (await runGit(["--git-dir", mirror, "rev-list", "--first-parent", "--ancestry-path", `${branchCommit}..${ref}`]).then((result) => result.stdout, () => "")).trim().split("\n");
  const oldest = path[path.length - 1];
  return oldest === undefined || oldest === "" ? undefined : oldest;
}

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
        let mergeCommit: string | undefined;
        if (write.branchCommit !== undefined && (await isAncestor(mirror, write.branchCommit, `refs/heads/${defaultBranch}`).catch(() => false))) {
          outcome = "merged";
          mergeCommit = await mergeCommitOf(mirror, write.branchCommit, defaultBranch);
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
        if (await deps.writes.markReviewOutcome(write.id, outcome, mergeCommit)) {
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
