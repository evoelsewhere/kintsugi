// The writer (ADR-0019): the only component that commits to a project's document repo.
// One `document-write` job at a time per repository. It brings the mirror up to date,
// validates the files, commits auto-commit paths straight to the default branch, pushes the
// rest to `kintsugi/<agent-or-actor>/<job-id>` and opens a pull request there (plain-git
// servers keep just the branch). Every commit is authored by kintsugi-bot — the commit identity
// set in the portal, read per write — with trailers.

import { join } from "node:path";
import { DEFAULT_AUTO_COMMIT_PATHS, isDirectPublishable, isWikiEditablePath, repositoryPath } from "@kintsugi/domain";
import {
  CheckoutStorage,
  type FileChange,
  GitError,
  PullRequestsUnsupportedError,
  type PullRequestServerKind,
  type RemoteOptions,
  type Trailer,
  WRITER_BRANCH_PREFIX,
  findPageIdOwners,
  hasBranch,
  isAncestor,
  pullRequestProvider,
  resolveCommit,
  runGit,
  seedEmptyRepository,
  writeFiles,
} from "@kintsugi/git";
import { MANIFEST_FILE, parseKintsugiYaml } from "@kintsugi/manifest";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { EmptyRepositoryError, remoteOptions, syncRepository } from "../git-sync/sync.js";
import type { DocumentWriteRequest } from "../queues.js";
import { OutputRuleError, decodeFiles, isDeleteEntry, isRenameEntry, pathsOfEntry, readOutputDir, splitByAutoCommit, validateOutputs } from "./outputs.js";
import { assertNoDuplicatePageIds } from "./page-ids.js";
import type { DocumentWriteOutcome, DocumentWriteStore } from "./store.js";

export interface WriterDeps {
  writes: DocumentWriteStore;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  /** Push attempts per branch (fetch → rebase → retry); default 4. */
  maxPushAttempts?: number;
  /** For tests: the HTTP client of the pull-request adapters. */
  fetch?: typeof fetch;
}

/** Ids that become path segments and branch names. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A branch-safe slug of an agent or user name: `legacy-analyst@1.2` → `legacy-analyst`. */
function slug(value: string): string {
  const cleaned = value
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/\.{2,}/g, ".");
  return cleaned === "" ? "kintsugi" : cleaned.slice(0, 64);
}

/** `kintsugi/<agent-or-actor>/<job-id>` (ADR-0019). */
export function writerBranch(request: DocumentWriteRequest): string {
  const who = request.agent ?? request.actor ?? request.kind;
  return `${WRITER_BRANCH_PREFIX}${slug(who)}/${request.jobId ?? request.writeId}`;
}

/** Provenance trailers (docs/reference/document-repo-commit-conventions.md), as applicable. */
export function writerTrailers(request: DocumentWriteRequest): Trailer[] {
  const trailers: Trailer[] = [];
  if (request.jobId !== undefined) trailers.push({ key: "Kintsugi-Job", value: request.jobId });
  if (request.agent !== undefined) trailers.push({ key: "Kintsugi-Agent", value: request.agent });
  if (request.actor !== undefined) trailers.push({ key: "Kintsugi-Actor", value: request.actor });
  if (request.unit !== undefined) trailers.push({ key: "Kintsugi-Unit", value: request.unit });
  // A page write names its page and says when the change is minor, which the history of the page reads back.
  if (request.kind === "page" && request.page?.id != null) trailers.push({ key: "Kintsugi-Page", value: request.page.id });
  if (request.kind === "page" && request.page?.minor === true) trailers.push({ key: "Kintsugi-Minor", value: "true" });
  return trailers;
}

function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => (secret.length >= 4 ? result.split(secret).join("[redacted]") : result), text);
}

/** The branch HEAD of the mirror points to (the remote's default branch). */
export async function mirrorDefaultBranch(mirror: string): Promise<string> {
  const { stdout } = await runGit(["--git-dir", mirror, "symbolic-ref", "--short", "HEAD"]);
  return stdout.trim();
}

/**
 * The files of a write without the create-only ones the default branch already has: the starter
 * structure fills in what is missing and never replaces a document a person wrote.
 */
async function withoutExisting(mirror: string, commit: string, files: readonly FileChange[], createOnly: ReadonlySet<string>): Promise<FileChange[]> {
  if (createOnly.size === 0) return [...files];
  const kept: FileChange[] = [];
  for (const file of files) {
    const exists = createOnly.has(file.path) && (await runGit(["--git-dir", mirror, "cat-file", "-e", `${commit}:${file.path}`]).then(
      () => true,
      () => false,
    ));
    if (!exists) kept.push(file);
  }
  return kept;
}

/**
 * `autoCommitPaths` and `directPublishPaths` from kintsugi.yaml on the default branch; the defaults (the starter's
 * auto-commit paths, no direct publish) when the file is missing or invalid, so a broken manifest never widens what is
 * written without review.
 */
async function manifestPaths(mirror: string, commit: string, options: RemoteOptions): Promise<{ autoCommit: readonly string[]; directPublish: readonly string[] }> {
  const defaults = { autoCommit: DEFAULT_AUTO_COMMIT_PATHS, directPublish: [] as readonly string[] };
  const text = await runGit(["--git-dir", mirror, "show", `${commit}:${MANIFEST_FILE}`], options).then(
    (result) => result.stdout,
    () => undefined,
  );
  if (text === undefined) return defaults;
  const parsed = parseKintsugiYaml(text);
  return parsed.ok ? { autoCommit: parsed.manifest.autoCommitPaths, directPublish: parsed.manifest.directPublishPaths } : defaults;
}

/** What the writer refuses of a page write whatever the API checked: paths the wiki may not write, and removals or moves without a hash. */
function assertPageWrite(files: readonly FileChange[], request: DocumentWriteRequest): void {
  for (const file of files) {
    for (const path of pathsOfEntry(file)) {
      if (!isWikiEditablePath(path)) throw new OutputRuleError(`"${path}" is not a path the wiki may write`);
    }
    if ((isDeleteEntry(file) || isRenameEntry(file)) && !/^[0-9a-f]{64}$/.test(file.expectedHash)) throw new OutputRuleError(`"${file.path}" needs the SHA-256 of the file as it was read`);
  }
  if (request.page !== undefined && !isWikiEditablePath(request.page.path)) throw new OutputRuleError(`"${request.page.path}" is not a path the wiki may write`);
}

function describeEntry(file: FileChange): string {
  if (isDeleteEntry(file)) return `- \`${file.path}\` (deleted)`;
  if (isRenameEntry(file)) return `- \`${file.path}\` (moved from \`${file.renameFrom}\`)`;
  return `- \`${file.path}\``;
}

function pullRequestBody(request: DocumentWriteRequest, files: readonly FileChange[]): string {
  const description = request.description?.trim();
  const lines = [request.message.trim(), "", ...(description === undefined || description === "" ? [] : [description, ""]), "Files:", ...files.map(describeEntry), "", "Opened by kintsugi-bot (ADR-0019)."];
  for (const trailer of writerTrailers(request)) lines.push(`${trailer.key}: ${trailer.value}`);
  return lines.join("\n");
}

/**
 * Performs one write and records its outcome on workflow.document_write. Rule violations
 * (bad paths, sizes, no document repo) are recorded and returned as `failed` without a
 * retry; other failures are recorded and rethrown so the queue retries them.
 */
/**
 * A refusal of the Git core that no retry can change: a file that changed since the person read it, a move onto another
 * file, a commit with too many entries. The write is recorded as failed and the queue does not try it again.
 */
function isContentConflict(error: unknown): boolean {
  return error instanceof GitError && /changed since it was read|a different document is already there|appears twice|removed twice|onto itself|another entry writes|at most \d+/.test(error.message);
}

/** The first commit of an empty document repository: the rest of the starter arrives through the pull request. */
const SEED_README = `# Document repository

The project's documents for Kintsugi: everything except code. Kintsugi proposes its changes through pull requests.
`;

/**
 * The branch a page write continues: an open `kintsugi/*` branch of this repository (it exists in the mirror, a write of
 * this project is waiting for its review and its tip is not on the default branch yet), with the pull request opened
 * for it. Anything else is refused (ADR-0098 decision 3).
 */
async function continuedBranch(deps: WriterDeps, mirror: string, defaultBranch: string, projectId: string, branch: string): Promise<{ branch: string; prUrl?: string }> {
  const refuse = (): never => {
    throw new OutputRuleError(`"${branch}" is not an open ${WRITER_BRANCH_PREFIX}* branch of this repository`);
  };
  if (!branch.startsWith(WRITER_BRANCH_PREFIX) || !/^[A-Za-z0-9._/-]+$/.test(branch) || !(await hasBranch(mirror, branch))) return refuse();
  const open = await deps.writes.openBranch(projectId, branch);
  if (open === undefined) return refuse();
  const tip = await resolveCommit(mirror, `refs/heads/${branch}`);
  if (await isAncestor(mirror, tip, `refs/heads/${defaultBranch}`)) return refuse();
  return { branch, ...(open.prUrl === undefined ? {} : { prUrl: open.prUrl }) };
}

export async function writeDocument(deps: WriterDeps, request: DocumentWriteRequest): Promise<DocumentWriteOutcome | { status: "failed"; error: string }> {
  await deps.writes.ensure(request);
  const secrets: string[] = [];
  try {
    if (!ID.test(request.writeId)) throw new OutputRuleError(`Invalid write id "${request.writeId}"`);
    if (request.jobId !== undefined && !ID.test(request.jobId)) throw new OutputRuleError(`Invalid job id "${request.jobId}"`);

    const target = await deps.writes.target(request.projectId);
    if (target === undefined) throw new OutputRuleError(`Project ${request.projectId} has no document repository`);
    const { repository } = target;
    if (repository.credential.kind === "token") secrets.push(repository.credential.token);
    if (repository.credential.kind === "ssh-key") secrets.push(repository.credential.privateKey);
    if (target.apiToken !== undefined) secrets.push(target.apiToken);

    const files = validateOutputs(
      request.files !== undefined ? decodeFiles(request.files) : request.outputOfJob !== undefined ? await readOutputDir(deps.storage.job(request.outputOfJob).out) : [],
    );
    // Only a page write (the wiki's publish, ADR-0098) may remove or move a file, publish directly or continue a branch.
    const isPageWrite = request.kind === "page";
    if (!isPageWrite && (files.some((file) => isDeleteEntry(file) || isRenameEntry(file)) || request.directPublish !== undefined || request.continues !== undefined)) {
      throw new OutputRuleError(`A write of kind "${request.kind}" cannot delete or move a file, publish directly or continue a branch`);
    }
    if (isPageWrite) assertPageWrite(files, request);

    // Fetch (or first clone) the mirror; this also refreshes the repository's sync status. A repository with no commit
    // (the guide's "create an empty repository") first gets a README on its default branch, so the write has a base.
    const sync = () => syncRepository({ store: deps.repositories, storage: deps.storage }, repository.id);
    await sync().catch(async (error: unknown) => {
      if (!(error instanceof EmptyRepositoryError)) throw error;
      await seedEmptyRepository(
        {
          url: repository.url,
          branch: repository.defaultBranch ?? "main",
          worktree: join(deps.storage.workspace(request.projectId), `${request.writeId}-seed`),
          message: "Start the document repository",
          identity: await deps.writes.commitIdentity(),
          files: [{ path: "README.md", content: SEED_README }],
        },
        remoteOptions(repository),
      ).catch(() => undefined); // someone else may have pushed first: the sync below tells
      await sync();
    });
    const mirror = deps.storage.mirror(repository.serverId, repository.id);
    const options = remoteOptions(repository);
    const defaultBranch = repository.defaultBranch ?? (await mirrorDefaultBranch(mirror));
    const head = await resolveCommit(mirror, `refs/heads/${defaultBranch}`);
    // Two pages never share an id: the writer is the last to check (ADR-0096 decision 4).
    await assertNoDuplicatePageIds(files, (id) => findPageIdOwners(mirror, head, id));
    const toWrite = await withoutExisting(mirror, head, files, new Set((request.files ?? []).filter((file) => file.createOnly === true).map((file) => file.path)));
    const paths = await manifestPaths(mirror, head, options);
    // A page write never uses autoCommitPaths: it goes to a pull request unless it asks to be published directly and
    // every path it touches is in directPublishPaths of the manifest at the head of the default branch (ADR-0098 decision 4).
    const direct = isPageWrite && request.directPublish === true && request.continues === undefined && toWrite.every((file) => pathsOfEntry(file).every((path) => isDirectPublishable(path, paths.directPublish)));
    const { autoCommit, review } = isPageWrite
      ? direct
        ? { autoCommit: toWrite, review: [] }
        : { autoCommit: [], review: toWrite }
      : request.reviewAll === true
        ? { autoCommit: [], review: toWrite }
        : splitByAutoCommit(toWrite, paths.autoCommit);
    const continued = request.continues === undefined ? undefined : await continuedBranch(deps, mirror, defaultBranch, request.projectId, request.continues);

    const common = {
      url: repository.url,
      mirrorPath: mirror,
      worktree: join(deps.storage.workspace(request.projectId), request.writeId),
      defaultBranch,
      message: request.message,
      identity: await deps.writes.commitIdentity(),
      trailers: writerTrailers(request),
      ...(deps.maxPushAttempts === undefined ? {} : { maxAttempts: deps.maxPushAttempts }),
    };
    const outcome: DocumentWriteOutcome = { status: "unchanged" };

    if (autoCommit.length > 0) {
      const result = await writeFiles({ ...common, branch: defaultBranch, files: autoCommit }, options);
      if (result.changed) {
        outcome.status = "committed";
        outcome.commit = result.commit;
        // The mirror takes the commit now, and a sync that sees the default branch move tells the worker, which asks for a
        // build of the Brain at once (and so, for a wiki, for the notifications of its watchers) instead of at the next sweep (P-009).
        await sync(); // the review branch starts after this commit
      }
    }

    if (review.length > 0) {
      const branch = continued?.branch ?? writerBranch(request);
      const result = await writeFiles({ ...common, branch, files: review }, options);
      if (result.changed || result.branch === branch) {
        outcome.status = "committed";
        outcome.branch = branch;
        outcome.branchCommit = result.commit;
        // A write that continues a branch updates the pull request that is open on it: no second one is opened.
        if (continued !== undefined) {
          if (continued.prUrl !== undefined) {
            outcome.status = "pr-opened";
            outcome.prUrl = continued.prUrl;
          }
          await deps.writes.markDone(request.writeId, outcome);
          return outcome;
        }
        const provider = pullRequestProvider(target.serverKind as PullRequestServerKind, deps.fetch);
        // plain-git has no pull requests, SSH-only servers have no API token, and some kinds
        // have no adapter yet: the pushed branch stays for a human to propose (ADR-0019).
        if (provider !== undefined && target.apiToken !== undefined) {
          const pr = await provider
            .open({
              baseUrl: target.serverBaseUrl,
              path: repositoryPath(repository.url, target.serverBaseUrl),
              token: target.apiToken,
              sourceBranch: branch,
              targetBranch: defaultBranch,
              title: request.message.trim().split("\n")[0]!,
              body: pullRequestBody(request, review),
            })
            .catch((error: unknown) => {
              if (error instanceof PullRequestsUnsupportedError) return undefined;
              throw error;
            });
          if (pr !== undefined) {
            outcome.status = "pr-opened";
            outcome.prUrl = pr.url;
          }
        }
      }
    }

    await deps.writes.markDone(request.writeId, outcome);
    return outcome;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), secrets);
    await deps.writes.markFailed(request.writeId, message);
    if (error instanceof OutputRuleError || isContentConflict(error)) return { status: "failed", error: message };
    // The redacted message only: pg-boss stores the error, and the original could carry a secret.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(message);
  }
}
