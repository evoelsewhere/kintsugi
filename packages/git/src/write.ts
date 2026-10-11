// The write side of the Git core (ADR-0019, ADR-0025): commit files in a worktree of a
// mirror as kintsugi-bot with provenance trailers, and push them to one allowed branch with
// fetch → rebase → retry on non-fast-forward. Never force-pushes, never runs hooks.

import { existsSync } from "node:fs";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GitError, runGit } from "./cli.js";
import { type RemoteOptions, addWorktree, assertSafeRemoteUrl, fetchMirror, resolveCommit } from "./repository.js";

/** Author and committer name of every automated commit (ADR-0019). */
export const BOT_NAME = "kintsugi-bot";

/** Branches the writer may create: `kintsugi/<agent-or-actor>/<job-id>` (ADR-0019). */
export const WRITER_BRANCH_PREFIX = "kintsugi/";

export interface CommitIdentity {
  name: string;
  email: string;
}

/** One file to write, at a path relative to the repository root (forward slashes). */
export interface FileWrite {
  path: string;
  content: string | Uint8Array;
}

/** A provenance trailer, e.g. `Kintsugi-Job: <id>` (docs/reference/document-repo.md). */
export interface Trailer {
  key: string;
  value: string;
}

export interface CommitInput {
  files: readonly FileWrite[];
  message: string;
  identity: CommitIdentity;
  trailers?: readonly Trailer[];
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[a-z]:/i;

/**
 * Validates a path inside the repository and returns it unchanged: relative, forward
 * slashes, no `.`/`..`/empty segments, nothing inside `.git`, no control characters.
 */
export function assertSafeRepoPath(path: string): string {
  const fail = (reason: string): never => {
    throw new GitError(`Invalid repository path "${path.replace(CONTROL, "?")}": ${reason}`, null, "");
  };
  if (path === "") fail("empty");
  if (CONTROL.test(path)) fail("control characters");
  if (path.includes("\\")) fail("backslashes are not allowed");
  if (path.startsWith("/") || DRIVE.test(path)) fail("absolute paths are not allowed");
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") fail("empty, '.' or '..' segments are not allowed");
    if (segment.toLowerCase() === ".git") fail("paths inside .git are not allowed");
  }
  return path;
}

/**
 * Refuses refs the writer must never push to. Allowed: the repository's default branch
 * (auto-commit paths) and `kintsugi/*` branches (pull requests); never tags or other refs.
 */
export async function assertWritableBranch(branch: string, defaultBranch: string): Promise<void> {
  const allowed = branch === defaultBranch || (branch.startsWith(WRITER_BRANCH_PREFIX) && /^[A-Za-z0-9._/-]+$/.test(branch));
  if (!allowed || branch.startsWith("-") || branch.startsWith("refs/")) {
    throw new GitError(`Refusing to write to "${branch}": only the default branch and ${WRITER_BRANCH_PREFIX}* branches are writable`, null, "");
  }
  await runGit(["check-ref-format", "--branch", branch]).catch(() => {
    throw new GitError(`Invalid branch name "${branch}"`, null, "");
  });
}

function assertIdentity(identity: CommitIdentity): void {
  for (const value of [identity.name, identity.email]) {
    if (value.trim() === "" || CONTROL.test(value) || /[<>]/.test(value)) throw new GitError(`Invalid commit identity "${value}"`, null, "");
  }
}

/** The message followed by one trailer paragraph; keys are tokens, values single lines. */
export function commitMessage(message: string, trailers: readonly Trailer[] = []): string {
  const body = message.replace(/\r\n/g, "\n").trim();
  if (body === "") throw new GitError("A commit needs a message", null, "");
  for (const { key, value } of trailers) {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key)) throw new GitError(`Invalid trailer key "${key}"`, null, "");
    if (value.trim() === "" || CONTROL.test(value)) throw new GitError(`Invalid value for trailer ${key}`, null, "");
  }
  return trailers.length === 0 ? `${body}\n` : `${body}\n\n${trailers.map(({ key, value }) => `${key}: ${value.trim()}`).join("\n")}\n`;
}

const identityConfig = (identity: CommitIdentity): string[] => ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`];

/** Refuses to write through a symbolic link: a repository could point one outside the worktree. */
async function assertNoSymlink(worktree: string, path: string): Promise<void> {
  let current = worktree;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    const stat = await lstat(current).catch(() => undefined);
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) throw new GitError(`Refusing to write "${path}" through a symbolic link`, null, "");
  }
}

/**
 * Writes the files into the worktree and commits them as `identity` (author and committer).
 * Returns the new commit, or undefined when the files are already identical.
 */
export async function commitFiles(worktree: string, input: CommitInput, options: RemoteOptions = {}): Promise<string | undefined> {
  assertIdentity(input.identity);
  const message = commitMessage(input.message, input.trailers);
  if (input.files.length === 0) throw new GitError("Nothing to commit: no files", null, "");
  const paths = input.files.map((file) => assertSafeRepoPath(file.path));
  if (new Set(paths).size !== paths.length) throw new GitError("A file appears twice in one commit", null, "");

  for (const file of input.files) {
    await assertNoSymlink(worktree, file.path);
    const target = join(worktree, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const run = { ...options, cwd: worktree };
  await runGit(["--literal-pathspecs", "add", "--", ...paths], run);
  const { stdout: staged } = await runGit(["diff", "--cached", "--name-only"], run);
  if (staged.trim() === "") return undefined;
  await runGit([...identityConfig(input.identity), "commit", "--quiet", "--no-verify", "--no-gpg-sign", "--cleanup=whitespace", "-F", "-"], {
    ...run,
    input: message,
  });
  return (await runGit(["rev-parse", "HEAD"], run)).stdout.trim();
}

/** Rejections worth a fetch → rebase → retry: someone else pushed first. */
const isNonFastForward = (error: unknown): boolean =>
  error instanceof GitError && /\[rejected\]|non-fast-forward|fetch first|stale info|cannot lock ref|failed to update ref/i.test(error.stderr);

export interface PushInput {
  /** Remote URL of the repository (credentials travel in `options`, never here). */
  url: string;
  /** The mirror the worktree belongs to; fetched before each rebase. */
  mirrorPath: string;
  branch: string;
  defaultBranch: string;
  /** Committer of rebased commits. */
  identity: CommitIdentity;
  /** Push attempts, rebases included; default 4. */
  maxAttempts?: number;
}

export interface PushResult {
  commit: string;
  attempts: number;
}

/**
 * Pushes the worktree's HEAD to `branch` — fast-forward only. On a non-fast-forward
 * rejection it fetches the mirror, rebases onto the new tip and tries again, up to
 * `maxAttempts`. A rebase conflict aborts and fails: it needs a human.
 */
export async function pushWithRebase(worktree: string, input: PushInput, options: RemoteOptions = {}): Promise<PushResult> {
  assertSafeRemoteUrl(input.url);
  await assertWritableBranch(input.branch, input.defaultBranch);
  assertIdentity(input.identity);
  const maxAttempts = Math.max(1, input.maxAttempts ?? 4);
  const run = { ...options, cwd: worktree };
  for (let attempt = 1; ; attempt++) {
    try {
      // No `+` in the refspec and no --force: the server refuses anything but a fast-forward.
      await runGit(["push", "--no-verify", "--", input.url, `HEAD:refs/heads/${input.branch}`], run);
      return { commit: (await runGit(["rev-parse", "HEAD"], run)).stdout.trim(), attempts: attempt };
    } catch (error) {
      if (!isNonFastForward(error) || attempt >= maxAttempts) throw error;
    }
    await fetchMirror(input.mirrorPath, options);
    const upstream = await resolveCommit(input.mirrorPath, `refs/heads/${input.branch}`);
    try {
      await runGit([...identityConfig(input.identity), "rebase", "--no-autostash", "--no-verify", upstream], run);
    } catch (error) {
      await runGit(["rebase", "--abort"], run).catch(() => undefined);
      throw new GitError(`Rebase onto ${input.branch} failed (conflicting change): ${error instanceof GitError ? error.message : String(error)}`, null, "");
    }
  }
}

/** Whether the mirror has `refs/heads/<branch>`. */
export async function hasBranch(mirrorPath: string, branch: string): Promise<boolean> {
  return runGit(["--git-dir", mirrorPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
}

/** Removes a leftover worktree (a crashed write) so a new one can take its place. */
async function clearWorktree(mirrorPath: string, dest: string): Promise<void> {
  if (existsSync(dest)) {
    await runGit(["--git-dir", mirrorPath, "worktree", "remove", "--force", "--", dest]).catch(() => undefined);
    await rm(dest, { recursive: true, force: true });
  }
  await runGit(["--git-dir", mirrorPath, "worktree", "prune"]);
}

export interface WriteFilesInput extends CommitInput {
  url: string;
  mirrorPath: string;
  /** Scratch directory for the write's worktree; replaced if it exists, removed afterwards. */
  worktree: string;
  defaultBranch: string;
  /** The default branch (auto-commit) or a `kintsugi/*` branch (pull request). */
  branch: string;
  maxAttempts?: number;
}

export interface WriteFilesResult {
  /** The branch written; when nothing changed, the branch the files were compared against. */
  branch: string;
  /** The commit at the tip of `branch` after the write. */
  commit: string;
  /** False when the files were already identical there: nothing was committed or pushed. */
  changed: boolean;
  attempts: number;
}

/**
 * The writer's one call: a worktree at `branch` (or at the default branch when `branch`
 * is new), the files committed with trailers, pushed fast-forward with bounded retries.
 * The mirror should be fetched just before.
 */
export async function writeFiles(input: WriteFilesInput, options: RemoteOptions = {}): Promise<WriteFilesResult> {
  assertSafeRemoteUrl(input.url);
  await assertWritableBranch(input.branch, input.defaultBranch);
  const start = (await hasBranch(input.mirrorPath, input.branch)) ? input.branch : input.defaultBranch;
  const base = await resolveCommit(input.mirrorPath, `refs/heads/${start}`);

  await clearWorktree(input.mirrorPath, input.worktree);
  await addWorktree(input.mirrorPath, input.worktree, base, options);
  try {
    const commit = await commitFiles(input.worktree, input, options);
    if (commit === undefined) return { branch: start, commit: base, changed: false, attempts: 0 };
    const pushed = await pushWithRebase(
      input.worktree,
      {
        url: input.url,
        mirrorPath: input.mirrorPath,
        branch: input.branch,
        defaultBranch: input.defaultBranch,
        identity: input.identity,
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      },
      options,
    );
    return { branch: input.branch, commit: pushed.commit, changed: true, attempts: pushed.attempts };
  } finally {
    await clearWorktree(input.mirrorPath, input.worktree).catch(() => undefined);
  }
}
