// The writer (ADR-0019): the only component that commits to a project's document repo.
// One `document-write` job at a time per repository. It brings the mirror up to date,
// validates the files, commits auto-commit paths straight to the default branch, pushes the
// rest to `kintsugi/<agent-or-actor>/<job-id>` and opens a pull request there (plain-git
// servers keep just the branch). Every commit is authored by kintsugi-bot — the commit identity
// set in the portal, read per write — with trailers.

import { join } from "node:path";
import { DEFAULT_AUTO_COMMIT_PATHS, repositoryPath } from "@kintsugi/domain";
import {
  CheckoutStorage,
  type FileWrite,
  PullRequestsUnsupportedError,
  type PullRequestServerKind,
  type RemoteOptions,
  type Trailer,
  WRITER_BRANCH_PREFIX,
  fetchMirror,
  pullRequestProvider,
  resolveCommit,
  runGit,
  writeFiles,
} from "@kintsugi/git";
import { MANIFEST_FILE, parseKintsugiYaml } from "@kintsugi/manifest";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { remoteOptions, syncRepository, withMirrorLock } from "../git-sync/sync.js";
import type { DocumentWriteRequest } from "../queues.js";
import { OutputRuleError, decodeFiles, readOutputDir, splitByAutoCommit, validateOutputs } from "./outputs.js";
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

/** `autoCommitPaths` from kintsugi.yaml on the default branch; the defaults when it is missing or invalid. */
async function autoCommitPaths(mirror: string, commit: string, options: RemoteOptions): Promise<readonly string[]> {
  const text = await runGit(["--git-dir", mirror, "show", `${commit}:${MANIFEST_FILE}`], options).then(
    (result) => result.stdout,
    () => undefined,
  );
  if (text === undefined) return DEFAULT_AUTO_COMMIT_PATHS;
  const parsed = parseKintsugiYaml(text);
  return parsed.ok ? parsed.manifest.autoCommitPaths : DEFAULT_AUTO_COMMIT_PATHS;
}

function pullRequestBody(request: DocumentWriteRequest, files: readonly FileWrite[]): string {
  const lines = [request.message.trim(), "", "Files:", ...files.map((file) => `- \`${file.path}\``), "", "Opened by kintsugi-bot (ADR-0019)."];
  for (const trailer of writerTrailers(request)) lines.push(`${trailer.key}: ${trailer.value}`);
  return lines.join("\n");
}

/**
 * Performs one write and records its outcome on workflow.document_write. Rule violations
 * (bad paths, sizes, no document repo) are recorded and returned as `failed` without a
 * retry; other failures are recorded and rethrown so the queue retries them.
 */
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

    // Fetch (or first clone) the mirror; this also refreshes the repository's sync status.
    await syncRepository({ store: deps.repositories, storage: deps.storage }, repository.id);
    const mirror = deps.storage.mirror(repository.serverId, repository.id);
    const options = remoteOptions(repository);
    const defaultBranch = repository.defaultBranch ?? (await mirrorDefaultBranch(mirror));
    const head = await resolveCommit(mirror, `refs/heads/${defaultBranch}`);
    const { autoCommit, review } = request.reviewAll === true ? { autoCommit: [], review: files } : splitByAutoCommit(files, await autoCommitPaths(mirror, head, options));

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
        await withMirrorLock(repository.id, () => fetchMirror(mirror, options)); // the review branch starts after this commit
      }
    }

    if (review.length > 0) {
      const branch = writerBranch(request);
      const result = await writeFiles({ ...common, branch, files: review }, options);
      if (result.changed || result.branch === branch) {
        outcome.status = "committed";
        outcome.branch = branch;
        outcome.branchCommit = result.commit;
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
    if (error instanceof OutputRuleError) return { status: "failed", error: message };
    // The redacted message only: pg-boss stores the error, and the original could carry a secret.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(message);
  }
}
