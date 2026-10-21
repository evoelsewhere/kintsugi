// Application layer: read-only access to a project's document repo through Kintsugi's mirror
// (ADR-0025, ADR-0028) — the refs worth looking at (the default branch and the outputs of recent
// runs and writes), a directory listing and a file at a ref. Refs are a commit id or an existing
// `refs/heads/<branch>`; paths are repository paths (no traversal, nothing in `.git`), and
// nothing under `restricted/` is ever served (restricted records are not committed, ADR-0029).

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from "@nestjs/common";
import { assertSafeRepoPath, GitError } from "@kintsugi/git";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import { type ProjectDetail, ProjectsService } from "#modules/admin/projects/index.js";
import { JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { type DocumentFile, type DocumentRef, type DocumentRefs, type DocumentRepo, type DocumentTree, MAX_DOCUMENT_BYTES, type MirrorBranch } from "../domain/document.js";
import { DocumentRepoReader } from "../domain/document.ports.js";

/** A project's document repo, ready to read: the mirror and its default branch. */
export interface DocumentContext {
  project: ProjectDetail;
  repo: DocumentRepo;
  defaultBranch: string;
}

/** A ref resolved to a commit. */
export interface ResolvedRef {
  ref: string;
  commit: string;
}

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const BRANCH_REF = /^refs\/heads\/([A-Za-z0-9._/-]+)$/;
/** How many recent runs and writes the ref list looks at. */
const RECENT = 50;

/** The branch of `refs/heads/<branch>`, or undefined when the text is not a valid branch ref. */
export function branchOfRef(ref: string): string | undefined {
  const branch = BRANCH_REF.exec(ref)?.[1];
  if (branch === undefined) return undefined;
  const invalid = branch.includes("..") || branch.includes("//") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".lock") || branch.includes("/.") || branch.startsWith(".");
  return invalid ? undefined : branch;
}

/** Throws unless `path` is a repository path that may be served (`""` is the root when allowed). */
export function servablePath(path: string, allowRoot: boolean): string {
  if (path === "" && allowRoot) return "";
  try {
    assertSafeRepoPath(path);
  } catch (error) {
    throw new BadRequestException(error instanceof GitError ? error.message : "Invalid path");
  }
  if (path.split("/").some((segment) => segment.toLowerCase() === "restricted")) {
    throw new ForbiddenException("Restricted records are never served from the document repo; read them under Governance → Restricted records.");
  }
  return path;
}

const isServable = (path: string): boolean => !path.split("/").some((segment) => segment.toLowerCase() === "restricted" || segment.toLowerCase() === ".git");

@Injectable()
export class DocumentsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly runs: JobRunsService,
    private readonly writes: DocumentWritesService,
    private readonly reader: DocumentRepoReader,
  ) {}

  /** The project's document repo mirror; 404 for an unknown project, 409 without a repo or mirror. */
  async context(projectId: string): Promise<DocumentContext> {
    const project = await this.projects.getProject(projectId);
    const linked = project.documentRepository;
    if (linked === null) throw new ConflictException(`Project ${projectId} has no document repository`);
    const repo: DocumentRepo = { serverId: linked.serverId, repositoryId: linked.repositoryId, ...(linked.defaultBranch === undefined ? {} : { defaultBranch: linked.defaultBranch }) };
    if (!(await this.reader.available(repo))) {
      throw new ConflictException(`The document repo ${linked.repositoryId} is not mirrored yet; the worker clones it on its next sync`);
    }
    const defaultBranch = repo.defaultBranch ?? (await this.reader.headBranch(repo)) ?? "main";
    return { project, repo, defaultBranch };
  }

  /** A ref (commit id or `refs/heads/<branch>`; the default branch when absent) as a commit; 400 or 404 otherwise. */
  async resolve(context: DocumentContext, ref: string | undefined): Promise<ResolvedRef> {
    const wanted = ref ?? `refs/heads/${context.defaultBranch}`;
    if (COMMIT_ID.test(wanted)) {
      if (!(await this.reader.hasCommit(context.repo, wanted))) throw new NotFoundException(`Commit ${wanted} is not in the document repo mirror`);
      return { ref: wanted, commit: wanted };
    }
    const branch = branchOfRef(wanted);
    if (branch === undefined) throw new BadRequestException(`Invalid ref "${wanted.slice(0, 100)}": use a commit id or refs/heads/<branch>`);
    const commit = await this.reader.branchTip(context.repo, branch);
    if (commit === undefined) throw new NotFoundException(`Branch ${branch} is not in the document repo mirror`);
    return { ref: wanted, commit };
  }

  /** The default branch and the outputs of recent successful runs and document writes, newest first. */
  async refs(projectId: string): Promise<DocumentRefs> {
    const context = await this.context(projectId);
    const [branches, runs, writes] = await Promise.all([
      this.reader.branches(context.repo),
      this.runs.list(projectId, undefined, { limit: RECENT, offset: 0 }),
      this.writes.list(projectId, { limit: RECENT, offset: 0 }),
    ]);
    const tips = new Map(branches.map((branch) => [branch.name, branch]));
    const defaultTip = tips.get(context.defaultBranch);
    const refs: DocumentRef[] = [];
    if (defaultTip !== undefined) {
      refs.push({ ref: `refs/heads/${context.defaultBranch}`, kind: "default", commit: defaultTip.commit, status: "default", branch: context.defaultBranch, date: defaultTip.date, label: `Default branch (${context.defaultBranch})` });
    }
    const seen = new Set<string>([context.defaultBranch]);
    // One ref per branch: the newest run or write that produced it.
    const pending: Array<Promise<DocumentRef | undefined>> = [];
    for (const run of runs.items) {
      const branch = run.documentWrite?.branch;
      if (branch === undefined || seen.has(branch) || run.kind !== "stage" || run.status !== "succeeded") continue;
      seen.add(branch);
      pending.push(this.runRef(context, run, tips, defaultTip));
    }
    for (const write of writes.items) {
      const branch = write.branch;
      const tip = branch === undefined ? undefined : tips.get(branch);
      if (branch === undefined || tip === undefined || seen.has(branch)) continue;
      seen.add(branch);
      pending.push(
        this.statusOf(context, tip, defaultTip).then((status) => ({
          ref: `refs/heads/${branch}`,
          kind: "write" as const,
          commit: tip.commit,
          status,
          branch,
          date: write.updatedAt,
          writeId: write.id,
          label: write.message.split("\n")[0] ?? branch,
        })),
      );
    }
    for (const ref of await Promise.all(pending)) if (ref !== undefined) refs.push(ref);
    return { defaultBranch: context.defaultBranch, refs };
  }

  /** The output ref of a successful stage run whose branch is still in the mirror. */
  async runRef(context: DocumentContext, run: JobRunView, tips: Map<string, MirrorBranch>, defaultTip: MirrorBranch | undefined): Promise<DocumentRef | undefined> {
    const branch = run.documentWrite?.branch;
    if (run.kind !== "stage" || run.status !== "succeeded" || branch === undefined) return undefined;
    const tip = tips.get(branch);
    if (tip === undefined) return undefined;
    return {
      ref: `refs/heads/${branch}`,
      kind: "run",
      commit: tip.commit,
      status: await this.statusOf(context, tip, defaultTip),
      branch,
      date: run.finishedAt ?? run.createdAt,
      stage: run.name,
      ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }),
      runId: run.id,
      ...(run.documentWrite?.id === undefined ? {} : { writeId: run.documentWrite.id }),
      label: `${run.name}${run.applicationId === undefined ? "" : ` · ${run.applicationId}`}`,
    };
  }

  /** Every branch of the mirror by name, and the default branch's tip. */
  async branchTips(context: DocumentContext): Promise<{ tips: Map<string, MirrorBranch>; defaultTip: MirrorBranch | undefined }> {
    const tips = new Map((await this.reader.branches(context.repo)).map((branch) => [branch.name, branch]));
    return { tips, defaultTip: tips.get(context.defaultBranch) };
  }

  /** A text file at a commit; undefined when it is missing, not a file, too large or binary. */
  async readText(context: DocumentContext, commit: string, path: string, maxBytes = MAX_DOCUMENT_BYTES): Promise<string | undefined> {
    const read = await this.reader.read(context.repo, commit, servablePath(path, false), maxBytes);
    return read.status === "ok" ? read.content : undefined;
  }

  /** The entry names of a directory at a commit; [] when it is not a directory. */
  async listNames(context: DocumentContext, commit: string, path: string): Promise<Array<{ name: string; kind: "file" | "dir" }>> {
    const entries = await this.reader.list(context.repo, commit, servablePath(path, true));
    return (entries ?? []).filter((entry) => isServable(entry.path)).map((entry) => ({ name: entry.name, kind: entry.kind }));
  }

  private async statusOf(context: DocumentContext, tip: MirrorBranch, defaultTip: MirrorBranch | undefined): Promise<"merged" | "open"> {
    if (defaultTip === undefined) return "open";
    return (await this.reader.isAncestor(context.repo, tip.commit, defaultTip.commit)) ? "merged" : "open";
  }

  /** The entries of a directory at a ref, without `restricted/` and `.git`. */
  async tree(projectId: string, ref: string | undefined, path: string): Promise<DocumentTree> {
    const dir = servablePath(path, true);
    const context = await this.context(projectId);
    const resolved = await this.resolve(context, ref);
    const entries = await this.reader.list(context.repo, resolved.commit, dir);
    if (entries === undefined) throw new NotFoundException(`${dir} is not a directory at ${resolved.ref}`);
    return {
      ...resolved,
      path: dir,
      entries: entries.filter((entry) => isServable(entry.path)).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1)),
    };
  }

  /** A text file at a ref (at most MAX_DOCUMENT_BYTES). */
  async file(projectId: string, ref: string | undefined, path: string): Promise<DocumentFile> {
    const file = servablePath(path, false);
    const context = await this.context(projectId);
    const resolved = await this.resolve(context, ref);
    const read = await this.reader.read(context.repo, resolved.commit, file, MAX_DOCUMENT_BYTES);
    switch (read.status) {
      case "missing":
        throw new NotFoundException(`${file} does not exist at ${resolved.ref}`);
      case "not-a-file":
        throw new BadRequestException(`${file} is a directory at ${resolved.ref}; list it with /documents/tree`);
      case "too-large":
        throw new PayloadTooLargeException(`${file} is ${read.size} bytes; the documents API serves files up to ${MAX_DOCUMENT_BYTES} bytes`);
      case "binary":
        throw new UnsupportedMediaTypeException(`${file} is not a text file`);
    }
    return { ...resolved, path: file, size: read.size, content: read.content };
  }
}
