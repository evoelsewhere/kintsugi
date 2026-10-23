// The manifest of a job workspace (ADR-0055): workspace.json at its root. The worker writes it before anything
// is mounted and updates it as the job moves through its states, so a later attempt, the sweep and a person
// looking at the folder can tell what the workspace was built for without asking the database.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PinnedSource } from "@kintsugi/domain";

export const MANIFEST_VERSION = 1;

/**
 * `running`: an attempt is running. `parked`: the job failed and can be retried. `published`: the attempt ended
 * well, or the job was cancelled; only `out/` is still needed, for the document write.
 */
export type WorkspaceLifecycle = "running" | "parked" | "published";

export interface WorkspaceManifest {
  version: typeof MANIFEST_VERSION;
  jobId: string;
  /** The attempt that last ran in this workspace (1 for the first). */
  attempt: number;
  state: WorkspaceLifecycle;
  /** Every repository the job reads, each at its pinned commit and mounted under its role's zone. */
  sources: PinnedSource[];
  /** The document-repo commit the declared documents are read at. */
  documentsCommit?: string;
  /** The commit `docs/` was last built for; `docs/` is rebuilt when it differs from `documentsCommit`. */
  documentsFor?: string;
  /** The last attempt that began from nothing at the person's request (retry from scratch). */
  freshApplied?: number;
  /** When the checkouts (as-is/, to-be/, docs/) were dropped; they are made again from the pins by the next attempt. */
  checkoutsDroppedAt?: string;
  updatedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The manifest at `file`; undefined when there is none or it is not one this version can read. */
export async function readManifest(file: string): Promise<WorkspaceManifest | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || value["version"] !== MANIFEST_VERSION || typeof value["jobId"] !== "string" || !Array.isArray(value["sources"])) return undefined;
    return value as unknown as WorkspaceManifest;
  } catch {
    return undefined;
  }
}

/** Writes the manifest whole or not at all. */
export async function writeManifest(file: string, manifest: Omit<WorkspaceManifest, "version" | "updatedAt">): Promise<WorkspaceManifest> {
  const complete: WorkspaceManifest = { ...manifest, version: MANIFEST_VERSION, updatedAt: new Date().toISOString() };
  await writeAtomically(file, `${JSON.stringify(complete, null, 2)}\n`);
  return complete;
}

/** A file replaced by renaming a finished copy over it: a reader sees the old content or the new one, never half. */
export async function writeAtomically(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
