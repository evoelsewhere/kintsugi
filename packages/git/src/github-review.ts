import { GitError, runGit } from "./cli.js";
import type { RemoteOptions } from "./repository.js";
import { resolveCommit } from "./repository.js";

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface PullRequestRevisionRequest {
  number: number;
  baseRef: string;
  expectedHeadSha: string;
  expectedBaseSha: string;
  expectedMergeBaseSha?: string;
}

export interface PullRequestRevision {
  headSha: string;
  baseSha: string;
  mergeBaseSha: string;
  /** Worker-owned refs are excluded from upstream mirror pruning and can be retained with the review. */
  headRef: string;
  baseRef: string;
}

/**
 * Fetches GitHub's stable PR-head ref and the observed base branch into Kintsugi-owned refs.
 * Exact SHAs are checked immediately so a moving PR or base branch never silently changes a review.
 */
export async function fetchPullRequestRefs(
  mirrorPath: string,
  request: PullRequestRevisionRequest,
  options: RemoteOptions = {},
): Promise<PullRequestRevision> {
  if (!Number.isSafeInteger(request.number) || request.number < 1 || request.number > 2_147_483_647) {
    throw new GitError("Pull request number must be a positive integer", null, "");
  }
  if (!COMMIT_ID.test(request.expectedHeadSha) || !COMMIT_ID.test(request.expectedBaseSha) ||
      (request.expectedMergeBaseSha !== undefined && !COMMIT_ID.test(request.expectedMergeBaseSha))) {
    throw new GitError("Pull request revisions must be full commit ids", null, "");
  }
  if (request.baseRef.length === 0 || request.baseRef.length > 255 || request.baseRef.includes("\0")) {
    throw new GitError("GitHub pull request has an invalid base branch", null, "");
  }
  const baseSource = `refs/heads/${request.baseRef}`;
  try {
    await runGit(["check-ref-format", baseSource]);
  } catch {
    throw new GitError("GitHub pull request has an invalid base branch", null, "");
  }

  const prefix = `refs/kintsugi/reviews/${request.number}/${request.expectedHeadSha}/${request.expectedBaseSha}`;
  const headRef = `${prefix}/head`;
  const baseRef = `${prefix}/base`;
  await runGit([
    "--git-dir", mirrorPath, "fetch", "--no-tags", "origin",
    `+refs/pull/${request.number}/head:${headRef}`,
    `+${baseSource}:${baseRef}`,
  ], options);

  const [headSha, baseSha] = await Promise.all([resolveCommit(mirrorPath, headRef), resolveCommit(mirrorPath, baseRef)]);
  if (headSha !== request.expectedHeadSha) {
    throw new GitError("GitHub pull request head changed after observation", null, "");
  }
  if (baseSha !== request.expectedBaseSha) {
    throw new GitError("GitHub pull request base changed after observation", null, "");
  }

  const { stdout: mergeBaseSha } = await runGit(["--git-dir", mirrorPath, "merge-base", headRef, baseRef]);
  const mergeBase = mergeBaseSha.trim();
  if (!COMMIT_ID.test(mergeBase)) throw new GitError("GitHub pull request has no valid Git merge base", null, "");
  if (request.expectedMergeBaseSha !== undefined && mergeBase !== request.expectedMergeBaseSha) {
    throw new GitError("GitHub pull request merge base differs from the observed revision", null, "");
  }

  return { headSha, baseSha, mergeBaseSha: mergeBase, headRef, baseRef };
}

/** Enumerates the complete changed-path set from immutable Git objects, independent of provider API caps. */
export async function listChangedPaths(mirrorPath: string, baseSha: string, headSha: string): Promise<string[]> {
  if (!COMMIT_ID.test(baseSha) || !COMMIT_ID.test(headSha)) throw new GitError("Changed-path enumeration needs full commit ids", null, "");
  const { stdout } = await runGit([
    "--git-dir", mirrorPath, "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv",
    baseSha, headSha, "--",
  ]);
  const paths = stdout.split("\0").filter((path) => path !== "");
  return paths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
