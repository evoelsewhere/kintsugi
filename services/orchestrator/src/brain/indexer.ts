// Builds a project's Brain (ADR-0091): reads the indexed Markdown documents of the chosen branch from the mirror and
// builds the tree with the domain's builder (no model, no embedding). A build is whole (every document is read and the
// stored tree replaced) or incremental (only the documents that changed since the stored commit are read, and the
// stored tree is brought to the new commit); both assemble the tree with the same code, so they store the same rows
// (ADR-0097 decision 6). A build reads a commit, so it needs no lock on the mirror: a fetch running meanwhile only adds
// objects.

import { randomBytes } from "node:crypto";
import {
  BRAIN_BUILDER_VERSION,
  BRAIN_INCREMENTAL_MAX_FILES,
  BRAIN_INCREMENTAL_MAX_SHARE,
  BRAIN_MAX_DOCUMENTS,
  BRAIN_MAX_FILE_BYTES,
  BRAIN_WHOLE_BUILD_EVERY,
  BRAIN_WHOLE_BUILD_MAX_AGE_MS,
  type BrainChange,
  type BrainSource,
  type BrainSourceDocument,
  assembleBrainTree,
  brainDocumentPart,
  brainPartsOfSources,
  isBrainIndexedPath,
} from "@kintsugi/domain";
import { type CheckoutStorage, prefetchDocumentBlobs, resolveCommit, runGit } from "@kintsugi/git";
import type { Pool } from "pg";
import type { RepositoryStore, SyncTarget } from "../git-sync/repositories.js";
import { remoteOptions } from "../git-sync/sync.js";
import { type BrainBuildState, PgBrainStore } from "./store.js";

export interface BrainIndexDeps {
  pool: Pool;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  log: (message: string) => void;
}

export type BrainIndexOutcome =
  | { status: "built"; mode: "whole" | "incremental"; commit: string; documents: number; nodes: number; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** Bytes of blobs read by one `cat-file` call; well under the output limit of `runGit`. */
const BATCH_BYTES = 24 * 1024 * 1024;
/** A build stuck this long in `queued` or `indexing` was lost with its worker and is due again. */
const STUCK_MS = 30 * 60 * 1000;
/** Commits of history read for the last change of each document; older changes stay unknown. */
const HISTORY_COMMITS = 10_000;
const SUBJECT_MAX = 200;

/**
 * The last commit that changed each of `paths`, from a walk of the history up to `commit` (trees only, so a
 * partial mirror needs no blob). The history is a help, not the index: a history too large to read in one go is
 * read again over fewer commits, and one that cannot be read leaves every change unknown rather than failing the
 * build.
 */
export async function lastChanges(mirror: string, commit: string, paths: ReadonlySet<string>): Promise<Map<string, BrainChange>> {
  for (const commits of [HISTORY_COMMITS, HISTORY_COMMITS / 10]) {
    try {
      return await walkHistory(mirror, commit, paths, commits);
    } catch {
      // Over the output or time limit of git: try fewer commits, then give up on the history.
    }
  }
  return new Map();
}

async function walkHistory(mirror: string, commit: string, paths: ReadonlySet<string>, commits: number): Promise<Map<string, BrainChange>> {
  const marker = `@@kintsugi-change-${randomBytes(8).toString("hex")}@@`;
  // `-z` keeps every path as it is (Git quotes a path with non-ASCII letters otherwise), and the extension matches in
  // any case, as the Brain indexes it.
  const { stdout } = await runGit(
    ["--git-dir", mirror, "log", "-z", `--format=${marker}%H%x09%cI%x09%s`, "--name-only", "--no-renames", `--max-count=${commits}`, commit, "--", ":(glob)**/*.[mM][dD]"],
    { timeoutMs: 2 * 60 * 1000 },
  );
  const found = new Map<string, BrainChange>();
  let current: BrainChange | undefined;
  for (const token of stdout.split("\0")) {
    // A commit's header line ends with a newline before its paths.
    const field = token.startsWith("\n") ? token.slice(1) : token;
    if (field.startsWith(marker)) {
      const [id = "", at = "", ...subject] = field.slice(marker.length).split("\t");
      current = { commit: id, at: new Date(at).toISOString(), subject: subject.join("\t").slice(0, SUBJECT_MAX) };
      continue;
    }
    const path = field;
    if (current !== undefined && path !== "" && paths.has(path) && !found.has(path)) {
      found.set(path, current);
      if (found.size === paths.size) break;
    }
  }
  return found;
}

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

/** The texts of the listed documents, read in batches of bounded size. */
async function readDocuments(mirror: string, listed: ReadonlyArray<{ path: string; blob: string; size: number }>, commit: string): Promise<BrainSourceDocument[]> {
  const texts = new Map<string, string>();
  let batch: string[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    for (const [blob, text] of await readBlobs(mirror, batch)) texts.set(blob, text);
    batch = [];
    bytes = 0;
  };
  for (const [blob, size] of new Map(listed.map((entry) => [entry.blob, entry.size]))) {
    if (bytes + size > BATCH_BYTES) await flush();
    batch.push(blob);
    bytes += size;
  }
  await flush();
  const changes = await lastChanges(mirror, commit, new Set(listed.map((entry) => entry.path)));
  return listed.flatMap((entry) => {
    const text = texts.get(entry.blob);
    const changed = changes.get(entry.path);
    return text === undefined ? [] : [{ path: entry.path, text, ...(changed === undefined ? {} : { changed }) }];
  });
}

/**
 * Why a build cannot be incremental, from what the index says about itself; undefined when it may be (the history of the
 * branch and the size of the change are looked at next). A whole build is the way out of every doubt (ADR-0097 decision 6).
 */
export function wholeBuildReason(source: BrainSource, state: BrainBuildState | undefined, commit: string, now = Date.now()): string | undefined {
  if (state === undefined || !state.refsComplete) return "the stored references are not those of a whole build of this version";
  if (source.builderVersion !== BRAIN_BUILDER_VERSION) return "the stored tree was built by another builder version";
  if (source.indexedCommit === null) return "nothing is built yet";
  if (source.indexedCommit === commit) return "the commit is the one built already";
  if (source.skipped > 0) return "documents were left out of the stored tree";
  if (state.incrementalBuilds >= BRAIN_WHOLE_BUILD_EVERY) return `${state.incrementalBuilds} incremental builds since the last whole one`;
  if (state.wholeBuiltAt === null || now - Date.parse(state.wholeBuiltAt) >= BRAIN_WHOLE_BUILD_MAX_AGE_MS) return "the last whole build is a day old";
  return undefined;
}

/** The indexed paths that differ between two commits, or why the change is too large or the stored commit is not behind the new one. */
async function changedIndexedPaths(mirror: string, base: string, commit: string, documents: number): Promise<{ paths: string[] } | { reason: string }> {
  try {
    await runGit(["--git-dir", mirror, "merge-base", "--is-ancestor", base, commit]);
  } catch {
    return { reason: "the stored commit is not an ancestor of the new one" };
  }
  const { stdout } = await runGit(["--git-dir", mirror, "diff", "--no-renames", "-z", "--name-only", base, commit], { timeoutMs: 2 * 60 * 1000 });
  const paths = [...new Set(stdout.split("\0").filter((path) => path !== "" && isBrainIndexedPath(path)))];
  if (paths.length > BRAIN_INCREMENTAL_MAX_FILES) return { reason: `${paths.length} indexed files changed` };
  if (paths.length > Math.max(1, Math.floor(documents / BRAIN_INCREMENTAL_MAX_SHARE))) return { reason: `${paths.length} of ${documents} documents changed` };
  return { paths };
}

/**
 * Brings the stored tree to `commit` from the documents that changed since `base`: they are read and built again, the
 * others are taken from the stored rows, and the tree is assembled as a whole build assembles it.
 */
async function buildIncrementally(
  deps: BrainIndexDeps,
  store: PgBrainStore,
  repo: DocumentRepo,
  projectId: string,
  title: string,
  base: string,
  commit: string,
  changedPaths: readonly string[],
  started: number,
): Promise<BrainIndexOutcome> {
  const listed = await listDocuments(repo.mirror, commit);
  const changed = new Set(changedPaths);
  const fresh = (await readDocuments(repo.mirror, listed.filter((entry) => changed.has(entry.path)), commit)).map(brainDocumentPart);
  const parts = [...(await store.parts(projectId, changedPaths)), ...fresh];
  // The stored documents and the ones read must be the documents of the commit: anything else is a stored tree that drifted.
  if (parts.length !== listed.length || parts.length > BRAIN_MAX_DOCUMENTS) throw new Error(`the stored documents and those of ${commit.slice(0, 12)} differ`);
  const tree = assembleBrainTree(parts, title, parts.length);
  const durationMs = Date.now() - started;
  await store.applyDelta(projectId, base, commit, BRAIN_BUILDER_VERSION, tree, { durationMs }, parts, changedPaths);
  deps.log(`brain of ${projectId}: incremental, ${changedPaths.length} changed documents, ${tree.documents} documents, ${tree.nodes.length} nodes at ${commit.slice(0, 12)} in ${durationMs} ms`);
  return { status: "built", mode: "incremental", commit, documents: tree.documents, nodes: tree.nodes.length, durationMs };
}

/** Builds and stores the tree of the project's chosen branch, incrementally when that is safe. Never throws: a failure is recorded on the index. */
export async function indexBrain(deps: BrainIndexDeps, projectId: string): Promise<BrainIndexOutcome> {
  const store = new PgBrainStore(deps.pool);
  // What the index says about itself before this build starts.
  const before = await store.source(projectId);
  const state = await store.buildState(projectId);
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
    const title = `${repo.projectName} · ${source.branch}`;

    const reason = before === undefined ? "nothing is built yet" : wholeBuildReason(before, state, commit);
    if (reason === undefined && before?.indexedCommit != null) {
      try {
        const change = await changedIndexedPaths(repo.mirror, before.indexedCommit, commit, before.documents);
        if ("paths" in change) return await buildIncrementally(deps, store, repo, projectId, title, before.indexedCommit, commit, change.paths, started);
        deps.log(`brain of ${projectId}: whole build, ${change.reason}`);
      } catch (error) {
        deps.log(`brain of ${projectId}: whole build after an incremental one failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (reason !== undefined) {
      deps.log(`brain of ${projectId}: whole build, ${reason}`);
    }

    const listed = await listDocuments(repo.mirror, commit);
    const documents = await readDocuments(repo.mirror, listed, commit);
    const { parts, indexed } = brainPartsOfSources(documents);
    const tree = assembleBrainTree(parts, title, indexed);
    const durationMs = Date.now() - started;
    await store.replace(projectId, commit, BRAIN_BUILDER_VERSION, tree, { durationMs }, parts);
    deps.log(`brain of ${projectId}: ${tree.documents} documents, ${tree.nodes.length} nodes from ${source.branch}@${commit.slice(0, 12)} in ${durationMs} ms`);
    return { status: "built", mode: "whole", commit, documents: tree.documents, nodes: tree.nodes.length, durationMs };
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
