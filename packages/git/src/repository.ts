// Git operations Kintsugi performs on registered repositories (ADR-0025): probe a remote,
// keep a bare mirror, and give each job a worktree at a fixed commit.

import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { GitError, type GitRunOptions, runGit } from "./cli.js";

export const MIN_GIT_VERSION = "2.40.0";

/** Remote options: everything but cwd and stdin, which each operation sets itself. */
export type RemoteOptions = Omit<GitRunOptions, "cwd" | "input">;

/** Parses `git --version` output, e.g. "git version 2.54.0.windows.1" → [2, 54, 0]. */
export function parseGitVersion(output: string): [number, number, number] | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

const atLeast = (version: [number, number, number], min: [number, number, number]): boolean => {
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== min[i]!) return version[i]! > min[i]!;
  }
  return true;
};

/** Fails when git is missing or older than MIN_GIT_VERSION; call once at startup. */
export async function checkGitVersion(): Promise<string> {
  const { stdout } = await runGit(["--version"]);
  const version = parseGitVersion(stdout);
  const min = parseGitVersion(`git version ${MIN_GIT_VERSION}`)!;
  if (version === undefined || !atLeast(version, min)) {
    throw new GitError(`Git ${MIN_GIT_VERSION} or later is required, found "${stdout.trim()}"`, null, "");
  }
  return version.join(".");
}

/**
 * Rejects remotes Kintsugi must not store: option-like values and URLs carrying
 * credentials (credentials travel per call, never in the URL or the mirror's config).
 */
export function assertSafeRemoteUrl(url: string): void {
  if (url.startsWith("-")) throw new GitError(`Invalid remote URL "${url}"`, null, "");
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    return; // scp-like SSH ("git@host:org/repo.git") or a local path; protocol.allow governs these
  }
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && (parsed.username !== "" || parsed.password !== "")) {
    throw new GitError("Remote URLs must not contain credentials; register them as the repository credential instead.", null, "");
  }
}

export interface RemoteBranch {
  name: string;
  commit: string;
}

export interface RemoteInfo {
  /** Branch HEAD points to, when the server reports it. */
  defaultBranch?: string;
  branches: RemoteBranch[];
}

/** Reads a remote's branches without cloning — "Test access" when registering a repository. */
export async function lsRemote(url: string, options: RemoteOptions = {}): Promise<RemoteInfo> {
  assertSafeRemoteUrl(url);
  const { stdout } = await runGit(["ls-remote", "--symref", "--", url, "HEAD", "refs/heads/*"], options);
  let defaultBranch: string | undefined;
  const branches: RemoteBranch[] = [];
  for (const line of stdout.split("\n")) {
    const symref = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
    if (symref !== null) {
      defaultBranch = symref[1];
      continue;
    }
    const head = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(line);
    if (head !== null) branches.push({ commit: head[1]!, name: head[2]! });
  }
  return { ...(defaultBranch === undefined ? {} : { defaultBranch }), branches };
}

export interface MirrorOptions extends RemoteOptions {
  /** Partial clone (`--filter=blob:none`) for large repositories: blobs are fetched on demand. */
  partial?: boolean;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** Creates the bare mirror of `url` at `mirrorPath` (which must not exist yet). */
export async function cloneMirror(url: string, mirrorPath: string, options: MirrorOptions = {}): Promise<void> {
  assertSafeRemoteUrl(url);
  if (await exists(mirrorPath)) throw new GitError(`Mirror already exists at ${mirrorPath}`, null, "");
  await mkdir(dirname(mirrorPath), { recursive: true });
  const { partial, ...run } = options;
  await runGit(["clone", "--mirror", ...(partial === true ? ["--filter=blob:none"] : []), "--", url, mirrorPath], run);
}

/** Updates a mirror from its remote, pruning deleted refs. */
export async function fetchMirror(mirrorPath: string, options: RemoteOptions = {}): Promise<void> {
  // A mirror's default `refs/*:refs/*` refspec would prune worker-owned refs/kintsugi pins.
  // Keep mirroring every remote namespace while excluding Kintsugi's local retention namespace.
  await runGit(["--git-dir", mirrorPath, "fetch", "--prune", "origin", "+refs/*:refs/*", "^refs/kintsugi/*"], options);
}

/** Resolves a ref (branch, tag, sha) in a mirror to a full commit id. */
export async function resolveCommit(mirrorPath: string, ref: string): Promise<string> {
  const { stdout } = await runGit(["--git-dir", mirrorPath, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return stdout.trim();
}

/** Whether `commit` is reachable from `ref` in a mirror (a merge or fast-forward brought it in; squash merges do not). */
export async function isAncestor(mirrorPath: string, commit: string, ref: string): Promise<boolean> {
  try {
    await runGit(["--git-dir", mirrorPath, "merge-base", "--is-ancestor", commit, ref]);
    return true;
  } catch (error) {
    // Exit status 1 is the answer "no"; anything else (unknown commit, broken mirror) is a real failure.
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * Checks out `commit` into `dest` as a detached worktree of the mirror — a job's `/src`.
 * Takes a full commit id, never a branch: a job always sees the commit recorded for it.
 * Remote options matter for partial mirrors, which fetch missing blobs on checkout.
 */
export async function addWorktree(mirrorPath: string, dest: string, commit: string, options: RemoteOptions = {}): Promise<void> {
  if (!COMMIT_ID.test(commit)) throw new GitError(`Worktrees need a full commit id, got "${commit}"`, null, "");
  await mkdir(dirname(dest), { recursive: true });
  await runGit(["--git-dir", mirrorPath, "worktree", "add", "--detach", "--", dest, commit], options);
}

/**
 * Whether `dest` is a worktree detached at `commit` with nothing changed in it: the check that lets a job workspace
 * reuse a checkout it made earlier (ADR-0055). False for a missing folder, another commit or a modified file.
 */
export async function worktreeIsAt(dest: string, commit: string): Promise<boolean> {
  try {
    const head = await runGit(["-C", dest, "rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"]);
    if (head.stdout.trim() !== commit) return false;
    const status = await runGit(["--no-optional-locks", "-C", dest, "status", "--porcelain", "--untracked-files=all"]);
    return status.stdout.trim() === "";
  } catch {
    return false;
  }
}

/** Forgets the worktrees of a mirror whose folder is gone. */
export async function pruneWorktrees(mirrorPath: string): Promise<void> {
  await runGit(["--git-dir", mirrorPath, "worktree", "prune"]);
}

/** Removes a job worktree and forgets it in the mirror. */
export async function removeWorktree(mirrorPath: string, dest: string): Promise<void> {
  await runGit(["--git-dir", mirrorPath, "worktree", "remove", "--force", "--", dest]);
  await runGit(["--git-dir", mirrorPath, "worktree", "prune"]);
}
