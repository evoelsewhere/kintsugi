// Provisioning a job workspace (ADR-0055): making the folders match the manifest, and taking the rebuildable ones
// away again. Both are safe to repeat. What can be made again from the pins (the checkouts of the repositories and
// the documents) is a cache; what cannot (out/, work/, .state/, workspace.json) is never touched here.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { SOURCE_ZONES, sourceFolder, sourceRole, type PinnedSource } from "@kintsugi/domain";
import type { JobPaths } from "@kintsugi/git";
import { removeTree } from "@kintsugi/runtime/launcher";
import type { SourceCheckouts } from "../jobs/model.js";
import { writeManifest, type WorkspaceManifest } from "./manifest.js";

/** Where a source is mounted: `as-is/<repository id>` or `to-be/<repository id>`. */
export function mountPath(paths: JobPaths, source: PinnedSource): string {
  return join(sourceRole(source) === "legacy" ? paths.asIs : paths.toBe, sourceFolder(source.repositoryId));
}

/** The mount of a source relative to the workspace root, with `/` separators (for the guide and the manifest). */
export const mountFolder = (source: PinnedSource): string => `${SOURCE_ZONES[sourceRole(source)]}/${sourceFolder(source.repositoryId)}`;

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/**
 * Mounts every source at its pinned commit. A folder that is already that commit with nothing changed is kept;
 * anything else in its place is removed and checked out again. Returns the sources that were mounted anew.
 */
export async function mountSources(checkouts: SourceCheckouts, paths: JobPaths, sources: readonly PinnedSource[], options: { readOnly?: boolean } = {}): Promise<PinnedSource[]> {
  const mounted: PinnedSource[] = [];
  for (const source of sources) {
    const dest = mountPath(paths, source);
    if (await checkouts.isCurrent(dest, source.commit)) continue;
    if (await exists(dest)) await checkouts.release(source.repositoryId, dest);
    await checkouts.checkout(source.repositoryId, source.commit, dest, { readOnly: options.readOnly !== false });
    mounted.push(source);
  }
  return mounted;
}

/**
 * Takes the checkouts, the documents and the scratch away: everything the pins in the manifest can make again.
 * The manifest records when, so the next attempt knows to provision.
 */
export async function dropCheckouts(checkouts: SourceCheckouts, paths: JobPaths, manifest: WorkspaceManifest): Promise<WorkspaceManifest> {
  for (const source of manifest.sources) {
    const dest = mountPath(paths, source);
    if (await exists(dest)) await checkouts.release(source.repositoryId, dest).catch(() => undefined);
  }
  for (const dir of [paths.asIs, paths.toBe, paths.docs, paths.steps, paths.tmp]) await removeTree(dir).catch(() => undefined);
  const { version: _version, updatedAt: _updatedAt, ...rest } = manifest;
  const { documentsFor: _documentsFor, ...kept } = rest;
  return writeManifest(paths.manifest, { ...kept, checkoutsDroppedAt: new Date().toISOString() });
}
