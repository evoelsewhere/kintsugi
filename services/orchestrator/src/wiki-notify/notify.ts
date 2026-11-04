// The wiki-notify job (ADR-0099 decision 3, COL-13): after a Brain build of a wiki project, the people who watch a page that
// changed, a folder above it or its space are told, once, if they still have Project Access and did not make the change.
// A notification holds ids only (the page key, the commit, the person who made the change), never a title or a text; the
// inbox looks the names up when it is read. The job starts from a cursor, the last commit the watchers were told about,
// so a request that was lost or came twice changes nothing: what is missing is asked for again by `dueWikiNotifies`.

import { type CheckoutStorage, runGit } from "@kintsugi/git";
import type { Pool } from "pg";
import { PgBrainStore } from "../brain/store.js";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { WIKI_NOTIFY_PAGE_LIMIT, authorsOfChanges, changedPages } from "./changes.js";
import { type NewWikiNotification, PgWikiNotifyStore } from "./store.js";

export interface WikiNotifyDeps {
  pool: Pool;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  log: (message: string) => void;
}

export type WikiNotifyOutcome =
  | { status: "notified"; pages: number; notifications: number; cut: number; from: string; to: string }
  /** Nothing to tell: the first run of a project, or a range already told. The cursor is where it should be. */
  | { status: "skipped"; reason: string };

async function isAncestor(mirror: string, ancestor: string, commit: string): Promise<boolean> {
  try {
    await runGit(["--git-dir", mirror, "merge-base", "--is-ancestor", ancestor, commit]);
    return true;
  } catch {
    return false;
  }
}

/** The mirror of the project's document repository. */
async function mirrorOf(deps: WikiNotifyDeps, projectId: string): Promise<string | undefined> {
  const result = await deps.pool.query<{ repository_id: string }>("select repository_id from admin.project_repository where project_id = $1 and role = 'document'", [projectId]);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const target = await deps.repositories.target(row.repository_id);
  return target === undefined ? undefined : deps.storage.mirror(target.serverId, target.id);
}

const foldersAbove = (path: string): string[] => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_part, index) => parts.slice(0, parts.length - index).join("/"));
};

/**
 * Tells the watchers what changed in the wiki between the cursor and `to`. The first run of a project only sets the cursor
 * (a wiki that is just switched on does not announce its whole history); a cursor that is not an ancestor of `to` (a branch
 * that was rewritten) is set to `to` without telling anything. The cursor moves after the notifications exist, so a run
 * that fails halfway is repeated from the same commit and the notifications it made are not made twice.
 */
export async function notifyWikiWatchers(deps: WikiNotifyDeps, projectId: string, to: string): Promise<WikiNotifyOutcome> {
  const brain = await new PgBrainStore(deps.pool).source(projectId);
  if (brain === undefined || !brain.enabled || !brain.wiki) return { status: "skipped", reason: "the project's wiki is not on" };
  const store = new PgWikiNotifyStore(deps.pool);
  const cursor = await store.cursor(projectId);
  if (cursor === undefined) {
    await store.setCursor(projectId, to);
    return { status: "skipped", reason: "first run: the cursor is set and nobody is told" };
  }
  if (cursor === to) return { status: "skipped", reason: "the watchers were told up to this commit" };
  const mirror = await mirrorOf(deps, projectId);
  if (mirror === undefined) throw new Error("The project has no document repository.");
  if (!(await isAncestor(mirror, cursor, to))) {
    // Either the request is older than the cursor (told already), or the history was rewritten (nothing to compare with).
    if (await isAncestor(mirror, to, cursor)) return { status: "skipped", reason: "the watchers were told past this commit" };
    await store.setCursor(projectId, to);
    deps.log(`wiki-notify of ${projectId}: ${cursor.slice(0, 12)} is not behind ${to.slice(0, 12)}, the cursor is set to it and nobody is told`);
    return { status: "skipped", reason: "the history was rewritten" };
  }

  const { changes, cut } = await changedPages(mirror, cursor, to);
  if (cut > 0) deps.log(`wiki-notify of ${projectId}: ${changes.length + cut} pages changed, the first ${WIKI_NOTIFY_PAGE_LIMIT} are told and ${cut} are left out`);
  const created = await createNotifications(store, projectId, mirror, cursor, to, changes);
  await store.setCursor(projectId, to);
  deps.log(`wiki-notify of ${projectId}: ${changes.length} pages changed since ${cursor.slice(0, 12)}, ${created} notifications at ${to.slice(0, 12)}`);
  return { status: "notified", pages: changes.length, notifications: created, cut, from: cursor, to };
}

async function createNotifications(store: PgWikiNotifyStore, projectId: string, mirror: string, from: string, to: string, changes: Awaited<ReturnType<typeof changedPages>>["changes"]): Promise<number> {
  if (changes.length === 0) return 0;
  const keyOf = (change: (typeof changes)[number]): string => change.pageId ?? `path:${change.path}`;
  // A page that was watched before it had an id is watched by its path, and one that was renamed by its old path too.
  const pagePaths = new Set(changes.flatMap((change) => [`path:${change.path}`, ...(change.oldPath === undefined ? [] : [`path:${change.oldPath}`])]));
  const pageKeys = [...new Set([...changes.map(keyOf), ...pagePaths])];
  const spaces = await store.spaces(projectId, changes.flatMap((change) => [change.path, ...(change.oldPath === undefined ? [] : [change.oldPath])]));
  const folders = new Set(changes.flatMap((change) => [...foldersAbove(change.path), ...(change.oldPath === undefined ? [] : foldersAbove(change.oldPath))]));
  const watchers = await store.watchers(projectId, { pages: pageKeys, folders: [...folders], spaces: [...new Set([...spaces.values()].filter((space): space is string => space !== null))] });
  if (watchers.length === 0) return 0;

  // Who made the changes: the actor trailers and author e-mail addresses of the commits that touched each page, and the
  // actor of the write a pull request came from.
  const authors = await authorsOfChanges(mirror, from, to);
  const writeActors = await store.writeActors(projectId, [...new Set([...authors.values()].flatMap((entry) => [...entry.commits]))]);
  const identities = [...authors.values()].flatMap((entry) => [...entry.actors, ...entry.emails]).concat([...writeActors.values()]);
  const users = await store.usersOf(identities);
  const authorsOf = (change: (typeof changes)[number]): string[] => {
    const entries = [authors.get(change.path), ...(change.oldPath === undefined ? [] : [authors.get(change.oldPath)])];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry === undefined) continue;
      for (const identity of [...entry.actors, ...entry.emails, ...[...entry.commits].flatMap((commit) => writeActors.get(commit) ?? [])]) {
        const user = users.get(identity);
        if (user !== undefined) ids.add(user);
      }
    }
    return [...ids].sort();
  };

  const notifications: NewWikiNotification[] = [];
  for (const change of changes) {
    const watching = new Set<string>();
    const targets = { page: new Set([keyOf(change), `path:${change.path}`, ...(change.oldPath === undefined ? [] : [`path:${change.oldPath}`])]), folder: new Set([...foldersAbove(change.path), ...(change.oldPath === undefined ? [] : foldersAbove(change.oldPath))]), space: new Set([spaces.get(change.path), change.oldPath === undefined ? null : spaces.get(change.oldPath)].filter((space): space is string => typeof space === "string")) };
    for (const watcher of watchers) if (targets[watcher.scopeKind].has(watcher.target)) watching.add(watcher.userId);
    const makers = authorsOf(change);
    for (const userId of [...watching].sort()) {
      if (makers.includes(userId)) continue;
      const actorId = makers[0];
      notifications.push({
        userId,
        projectId,
        dedupeKey: `wiki-page-changed:${userId}:${keyOf(change)}:${to}`,
        subject: { pageKey: keyOf(change), commit: to, ...(actorId === undefined ? {} : { actorId }) },
      });
    }
  }
  return store.create(notifications);
}

/** The projects whose watchers are behind the Brain: what the sweep that finds due builds asks for again. */
export async function dueWikiNotifies(deps: Pick<WikiNotifyDeps, "pool">): Promise<Array<{ projectId: string; from: string | null; to: string }>> {
  return new PgWikiNotifyStore(deps.pool).due();
}
