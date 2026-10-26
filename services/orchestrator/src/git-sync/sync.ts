// Git sync (ADR-0025): keeps one bare mirror per registered repository in Kintsugi's
// storage — mirror-clone on first sync, fetch afterwards — and records the commit the
// default branch points to. Mirrors of removed repositories are pruned.

import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror, isLoopbackUrl, prefetchDocumentBlobs, type RemoteOptions, resolveCommit } from "@kintsugi/git";
import type { RepositoryStore, SyncTarget } from "./repositories.js";

export interface SyncDeps {
  store: RepositoryStore;
  storage: CheckoutStorage;
}

export interface SyncResult {
  repositoryId: string;
  commit: string;
  cloned: boolean;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** A clone or fetch of a large legacy repository can take a while. */
const GIT_TIMEOUT_MS = 30 * 60 * 1000;

/** How the worker reaches a repository for one Git call. */
export function remoteOptions(target: SyncTarget): RemoteOptions {
  return {
    credential: target.credential,
    ...(target.knownHosts === undefined ? {} : { knownHosts: target.knownHosts }),
    // Plain http only for anonymous servers or a server on this machine (the API refuses tokens over http elsewhere).
    allowHttp: target.credential.kind === "none" || isLoopbackUrl(target.url),
    remoteUrl: target.url,
    timeoutMs: GIT_TIMEOUT_MS,
  };
}

/**
 * Brings one repository's mirror up to date. Returns undefined when the repository was
 * removed meanwhile. On failure the repository is marked `error` and the error rethrown,
 * so the queue retries it.
 */
// One mirror operation per repository at a time in this process: the git-sync queue, job
// checkouts and the document writer all sync mirrors, and two clones of one mirror collide.
const mirrorLocks = new Map<string, Promise<unknown>>();

/** Runs `operation` after every earlier operation on the same repository's mirror has settled. */
export function withMirrorLock<T>(repositoryId: string, operation: () => Promise<T>): Promise<T> {
  const previous = mirrorLocks.get(repositoryId) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  mirrorLocks.set(repositoryId, settled);
  void settled.then(() => {
    if (mirrorLocks.get(repositoryId) === settled) mirrorLocks.delete(repositoryId);
  });
  return next;
}

/** A default-branch move a sync saw: the tip before and after the fetch. */
export interface DefaultTipMove {
  repositoryId: string;
  mirror: string;
  previous: string;
  commit: string;
}

type TipListener = (move: DefaultTipMove) => Promise<void> | void;
const tipListeners = new Set<TipListener>();

/**
 * Calls `listener` whenever any sync of this process (the git-sync queue, job checkouts, the
 * document writer) moves a mirror's default branch; returns the unsubscribe function. Listener
 * errors are swallowed: they never fail a sync.
 */
export function onDefaultTipMove(listener: TipListener): () => void {
  tipListeners.add(listener);
  return () => tipListeners.delete(listener);
}

export function syncRepository(deps: SyncDeps, repositoryId: string): Promise<SyncResult | undefined> {
  return withMirrorLock(repositoryId, () => syncUnlocked(deps, repositoryId));
}

async function syncUnlocked({ store, storage }: SyncDeps, repositoryId: string): Promise<SyncResult | undefined> {
  const target = await store.target(repositoryId);
  if (target === undefined) return undefined;

  const mirror = storage.mirror(target.serverId, target.id);
  const options = remoteOptions(target);
  const cloned = !(await exists(mirror));
  try {
    if (cloned) {
      await store.markCloning(target.id);
      try {
        // Partial clone: blobs arrive on demand when a job checks out a commit.
        await cloneMirror(target.url, mirror, { ...options, partial: true });
      } catch (error) {
        // Never leave a half-cloned mirror behind: the next attempt starts clean.
        await rm(mirror, { recursive: true, force: true });
        throw error;
      }
    }
    const ref = target.defaultBranch === undefined ? "HEAD" : `refs/heads/${target.defaultBranch}`;
    const previous = cloned ? undefined : await resolveCommit(mirror, ref).catch(() => undefined);
    if (!cloned) await fetchMirror(mirror, options);
    const commit = await resolveCommit(mirror, ref);
    // The API reads the mirror without a credential, so the documents of the tip must already be local.
    // Best effort: a server that refuses the fetch leaves the sync as it was, and a job checkout still fetches blobs.
    await prefetchDocumentBlobs(mirror, commit, options).catch(() => undefined);
    await store.markReady(target.id, commit);
    if (previous !== undefined && previous !== commit) {
      for (const listener of tipListeners) {
        try {
          await listener({ repositoryId: target.id, mirror, previous, commit });
        } catch {
          // A listener never fails the sync.
        }
      }
    }
    return { repositoryId: target.id, commit, cloned };
  } catch (error) {
    await store.markError(target.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Deletes mirrors whose repository is no longer registered. Returns the removed keys. */
export async function pruneMirrors({ store, storage }: SyncDeps): Promise<string[]> {
  const mirrorsRoot = join(storage.root, "git", "mirrors");
  const found: string[] = [];
  const servers = await readdir(mirrorsRoot, { withFileTypes: true }).catch(() => []);
  for (const server of servers.filter((entry) => entry.isDirectory())) {
    for (const entry of await readdir(join(mirrorsRoot, server.name), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith(".git")) found.push(`${server.name}/${entry.name.slice(0, -".git".length)}`);
    }
  }
  // Read the registrations after listing the disk: a repository registered (and its clone
  // started) after the listing is not in `found`, so an in-progress clone is never pruned.
  const keep = await store.mirrorKeys();
  const removed = found.filter((key) => !keep.has(key));
  for (const key of removed) {
    await rm(join(mirrorsRoot, `${key}.git`), { recursive: true, force: true });
  }
  return removed;
}
