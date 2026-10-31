// Builds a project's Brain (ADR-0091): reads every indexed Markdown document of the chosen branch from the
// mirror, builds the tree with the domain's builder (no model, no embedding) and replaces the stored tree.
// A build reads a commit, so it needs no lock on the mirror: a fetch running meanwhile only adds objects.

import { randomBytes } from "node:crypto";
import { BRAIN_BUILDER_VERSION, BRAIN_MAX_FILE_BYTES, type BrainSource, type BrainSourceDocument, buildBrainTree, isBrainIndexedPath } from "@kintsugi/domain";
import { type CheckoutStorage, prefetchDocumentBlobs, resolveCommit, runGit } from "@kintsugi/git";
import type { Pool } from "pg";
import type { RepositoryStore, SyncTarget } from "../git-sync/repositories.js";
import { remoteOptions } from "../git-sync/sync.js";
import { PgBrainStore } from "./store.js";

export interface BrainIndexDeps {
  pool: Pool;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  log: (message: string) => void;
}

export type BrainIndexOutcome =
  | { status: "built"; commit: string; documents: number; nodes: number; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** Bytes of blobs read by one `cat-file` call; well under the output limit of `runGit`. */
const BATCH_BYTES = 24 * 1024 * 1024;
/** A build stuck this long in `queued` or `indexing` was lost with its worker and is due again. */
const STUCK_MS = 30 * 60 * 1000;

interface DocumentRepo {
  target: SyncTarget;
  mirror: string;
  projectName: string;
}

async function documentRepo(deps: BrainIndexDeps, projectId: string): Promise<DocumentRepo | undefined> {
  const result = await deps.pool.query<{ repository_id: string; name: string }>(
    `select l.repository_id, p.name from admin.project_repository l join admin.project p on p.id = l.project_id
      where l.project_id = $1 and l.role = 'document'`,
    [projectId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const target = await deps.repositories.target(row.repository_id);
  if (target === undefined) return undefined;
  return { target, mirror: deps.storage.mirror(target.serverId, target.id), projectName: row.name };
}

/** The indexed Markdown blobs of a commit: path, blob id and size, without the files over the size bound. */
async function listDocuments(mirror: string, commit: string): Promise<Array<{ path: string; blob: string; size: number }>> {
  const { stdout } = await runGit(["--git-dir", mirror, "ls-tree", "-r", "-l", "-z", commit]);
  const found: Array<{ path: string; blob: string; size: number }> = [];
  for (const record of stdout.split("\0")) {
    const match = /^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/s.exec(record);
    if (match === null) continue;
    const [, blob, size, path] = match;
    if (blob === undefined || size === undefined || path === undefined) continue;
    if (Number(size) <= BRAIN_MAX_FILE_BYTES && isBrainIndexedPath(path)) found.push({ path, blob, size: Number(size) });
  }
  return found;
}

/**
 * The text of several blobs in one `cat-file --batch` call. Each blob follows a header line made of a random
 * marker and its id, so the output splits on the markers without counting bytes of UTF-8 text.
 */
async function readBlobs(mirror: string, blobs: readonly string[]): Promise<Map<string, string>> {
  const marker = `@@kintsugi-brain-${randomBytes(12).toString("hex")}@@`;
  const { stdout } = await runGit(["--git-dir", mirror, "cat-file", `--batch=${marker} %(objectname) %(objecttype)`], {
    input: `${blobs.join("\n")}\n`,
    timeoutMs: 5 * 60 * 1000,
  });
  const texts = new Map<string, string>();
  const parts = stdout.split(`${marker} `);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const [blob, type] = part.slice(0, newline).split(" ");
    if (blob === undefined || type !== "blob") continue;
    // git ends every object with a newline of its own.
    const body = part.slice(newline + 1);
    texts.set(blob, body.endsWith("\n") ? body.slice(0, -1) : body);
  }
  return texts;
}

/** Builds and stores the tree of the project's chosen branch. Never throws: a failure is recorded on the index. */
export async function indexBrain(deps: BrainIndexDeps, projectId: string): Promise<BrainIndexOutcome> {
  const store = new PgBrainStore(deps.pool);
  const source = await store.begin(projectId);
  if (source === undefined) return { status: "skipped", reason: "the project has no enabled Brain" };
  const started = Date.now();
  try {
    const repo = await documentRepo(deps, projectId);
    if (repo === undefined) throw new Error("The project has no document repository.");
    let commit: string;
    try {
      commit = await resolveCommit(repo.mirror, `refs/heads/${source.branch}`);
    } catch {
      throw new Error(`Branch ${source.branch} is not in the mirror of the document repository. Check the branch name, or wait for the next sync.`);
    }
    await store.attempt(projectId, commit);
    // A branch other than the default one has no document blobs in the partial mirror until they are fetched.
    await prefetchDocumentBlobs(repo.mirror, commit, remoteOptions(repo.target));
    const listed = await listDocuments(repo.mirror, commit);
    const texts = new Map<string, string>();
    let batch: string[] = [];
    let bytes = 0;
    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      for (const [blob, text] of await readBlobs(repo.mirror, batch)) texts.set(blob, text);
      batch = [];
      bytes = 0;
    };
    for (const [blob, size] of new Map(listed.map((entry) => [entry.blob, entry.size]))) {
      if (bytes + size > BATCH_BYTES) await flush();
      batch.push(blob);
      bytes += size;
    }
    await flush();
    const documents: BrainSourceDocument[] = listed.flatMap((entry) => {
      const text = texts.get(entry.blob);
      return text === undefined ? [] : [{ path: entry.path, text }];
    });
    const tree = buildBrainTree(documents, `${repo.projectName} · ${source.branch}`);
    const durationMs = Date.now() - started;
    await store.replace(projectId, commit, BRAIN_BUILDER_VERSION, tree, { durationMs });
    deps.log(`brain of ${projectId}: ${tree.documents} documents, ${tree.nodes.length} nodes from ${source.branch}@${commit.slice(0, 12)} in ${durationMs} ms`);
    return { status: "built", commit, documents: tree.documents, nodes: tree.nodes.length, durationMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.fail(projectId, message);
    deps.log(`brain of ${projectId} failed: ${message}`);
    return { status: "failed", error: message };
  }
}

/** Whether an enabled index needs a build now, given the tip of its branch (undefined: the branch is not there). */
export function brainBuildDue(source: BrainSource, tip: string | undefined, now = Date.now()): boolean {
  const since = (value: string | null): number => (value === null ? Number.POSITIVE_INFINITY : now - Date.parse(value));
  if (source.state === "queued") return since(source.requestedAt) > STUCK_MS;
  if (source.state === "indexing") return since(source.startedAt) > STUCK_MS;
  // A branch that went away: one build records why the index no longer follows it.
  if (tip === undefined) return source.state === "ready";
  if (source.builderVersion !== null && source.builderVersion !== BRAIN_BUILDER_VERSION) return true;
  if (source.indexedCommit === tip) return false;
  return !(source.state === "failed" && source.attemptedCommit === tip);
}

/** The projects whose Brain is due a build, optionally only those of one document repository. */
export async function dueBrainBuilds(deps: BrainIndexDeps, repositoryId?: string): Promise<string[]> {
  const store = new PgBrainStore(deps.pool);
  const due: string[] = [];
  for (const { source, repositoryId: repository } of await store.enabled(repositoryId)) {
    const target = await deps.repositories.target(repository);
    if (target === undefined) continue;
    const mirror = deps.storage.mirror(target.serverId, target.id);
    const tip = await resolveCommit(mirror, `refs/heads/${source.branch}`).catch(() => undefined);
    if (brainBuildDue(source, tip)) due.push(source.projectId);
  }
  return due;
}
