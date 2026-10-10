// Git sync (ADR-0025): keeps one bare mirror per registered repository in Kintsugi's
// storage — mirror-clone on first sync, fetch afterwards — and records the commit the
// default branch points to. Mirrors of removed repositories are pruned.

import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror, type RemoteOptions, resolveCommit } from "@kintsugi/git";
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

function remoteOptions(target: SyncTarget): RemoteOptions {
  return {
    credential: target.credential,
    ...(target.knownHosts === undefined ? {} : { knownHosts: target.knownHosts }),
    // Plain http only for anonymous servers (the API refuses tokens over http).
    allowHttp: target.credential.kind === "none",
    timeoutMs: GIT_TIMEOUT_MS,
  };
}

/**
 * Brings one repository's mirror up to date. Returns undefined when the repository was
 * removed meanwhile. On failure the repository is marked `error` and the error rethrown,
 * so the queue retries it.
 */
export async function syncRepository({ store, storage }: SyncDeps, repositoryId: string): Promise<SyncResult | undefined> {
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
    } else {
      await fetchMirror(mirror, options);
    }
    const commit = await resolveCommit(mirror, target.defaultBranch === undefined ? "HEAD" : `refs/heads/${target.defaultBranch}`);
    await store.markReady(target.id, commit);
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
