// Test doubles for job runs: an in-memory job store, checkouts of local fixture repositories,
// and an agent runtime that writes files the way a real agent would through write
// before running the mock backend (no LLM).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addWorktree, removeWorktree, resolveCommit, runGit, worktreeIsAt } from "@kintsugi/git";
import { createAgentRuntime } from "@kintsugi/runtime";
import { makeReadOnly, makeWritable } from "@kintsugi/runtime/launcher";
import type { AgentRuntime, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import type { SourceRepo } from "@kintsugi/domain";
import type { ArtifactEntry, JobEventRecord, JobRun, JobStore, ModelBinding, NewJobRun, SourceCheckouts, SpanRecord } from "../../src/jobs/model.js";
import type { DocumentWriteRequest } from "../../src/queues.js";

export class MemoryJobStore implements JobStore {
  readonly runs = new Map<string, JobRun>();
  readonly artifacts = new Map<string, ArtifactEntry[]>();
  readonly restricted = new Map<string, Map<string, string>>();
  readonly writes: Array<{ runId: string; request: DocumentWriteRequest }> = [];
  document: string | undefined = "docs";
  bindings: Record<string, ModelBinding> = {};

  async get(id: string): Promise<JobRun | undefined> {
    const run = this.runs.get(id);
    return run === undefined ? undefined : structuredClone(run);
  }
  async create(run: NewJobRun): Promise<void> {
    this.runs.set(run.id, { ...run, status: "queued", attempt: 1, inputs: run.inputs ?? {}, limits: run.limits ?? {} });
  }
  /** What the API does for a retry of a failed run: the same run goes back in the queue as the next attempt (ADR-0055). */
  requeue(id: string, inputs?: Record<string, unknown>): void {
    const run = this.runs.get(id)!;
    run.status = "queued";
    run.attempt += 1;
    delete run.failureReason;
    if (inputs !== undefined) run.inputs = { ...run.inputs, ...inputs };
  }
  readonly events: JobEventRecord[] = [];
  readonly cancelRequests = new Set<string>();
  async start(id: string): Promise<boolean> {
    const run = this.runs.get(id)!;
    if (run.status !== "queued") return false;
    run.status = "running";
    return true;
  }
  async cancel(id: string): Promise<void> {
    const run = this.runs.get(id)!;
    if (run.status === "queued" || run.status === "running") run.status = "cancelled";
  }
  async cancelRequested(ids: readonly string[]): Promise<string[]> {
    return ids.filter((id) => this.cancelRequests.has(id));
  }
  async addEvent(event: JobEventRecord): Promise<void> {
    this.events.push(event);
  }
  readonly spans: SpanRecord[] = [];
  async addSpans(spans: readonly SpanRecord[]): Promise<void> {
    this.spans.push(...spans);
  }
  async update(id: string, patch: { sources?: SourceRepo[]; scriptHash?: string; agent?: string }): Promise<void> {
    const run = this.runs.get(id)!;
    Object.assign(run, patch);
    if (patch.sources?.[0]?.commit !== undefined) run.sourceCommit = patch.sources[0].commit;
  }
  async succeed(id: string, summary: Record<string, unknown>): Promise<void> {
    Object.assign(this.runs.get(id)!, { status: "succeeded", outputSummary: summary });
  }
  async fail(id: string, reason: string, summary?: Record<string, unknown>): Promise<void> {
    Object.assign(this.runs.get(id)!, { status: "failed", failureReason: reason, ...(summary === undefined ? {} : { outputSummary: summary }) });
  }
  async addArtifacts(id: string, entries: readonly ArtifactEntry[]): Promise<void> {
    this.artifacts.set(id, [...entries]);
  }
  async addRestricted(id: string, path: string, content: Buffer): Promise<void> {
    const records = this.restricted.get(id) ?? new Map<string, string>();
    records.set(path, content.toString("utf8"));
    this.restricted.set(id, records);
  }
  async recordDocumentWrite(id: string, request: DocumentWriteRequest): Promise<void> {
    this.writes.push({ runId: id, request });
    this.runs.get(id)!.documentWriteId = request.writeId;
  }
  async documentRepository(): Promise<string | undefined> {
    return this.document;
  }
  async modelBinding(agent: string): Promise<ModelBinding | undefined> {
    return this.bindings[agent];
  }
  children(parentId: string): JobRun[] {
    return [...this.runs.values()].filter((run) => run.parentId === parentId);
  }
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });

/** A bare fixture repository in a temp directory with the given files on `main`. */
export function fixtureRepository(files: Record<string, string>): { bare: string; remove(): Promise<void> } {
  const root = mkdtempSync(join(tmpdir(), "kintsugi-fixture-repo-"));
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "fixture");
  const bare = join(root, "repo.git");
  git(root, "clone", "-q", "--bare", work, bare);
  return { bare, remove: () => rm(root, { recursive: true, force: true }) };
}

/** Checkouts of local bare repositories, by repository id. */
export class LocalCheckouts implements SourceCheckouts {
  constructor(private readonly repositories: Record<string, string>) {}

  #mirror(id: string): string {
    const mirror = this.repositories[id];
    if (mirror === undefined) throw new Error(`unknown repository ${id}`);
    return mirror;
  }
  async resolve(id: string): Promise<string> {
    return resolveCommit(this.#mirror(id), "refs/heads/main");
  }
  /** The checkouts made, for tests that look at how often a workspace mounts again. */
  readonly checkouts: Array<{ id: string; commit: string; dest: string }> = [];
  async checkout(id: string, commit: string, dest: string, options: { readOnly?: boolean } = {}): Promise<void> {
    await addWorktree(this.#mirror(id), dest, commit);
    if (options.readOnly !== false) await makeReadOnly(dest);
    this.checkouts.push({ id, commit, dest });
  }
  async isCurrent(dest: string, commit: string): Promise<boolean> {
    return worktreeIsAt(dest, commit);
  }
  async readDocument(id: string, commit: string, path: string): Promise<string | undefined> {
    return runGit(["--git-dir", this.#mirror(id), "show", `${commit}:${path}`]).then(
      (result) => result.stdout,
      () => undefined,
    );
  }
  async listDocuments(id: string, commit: string, dir: string): Promise<string[]> {
    return runGit(["--git-dir", this.#mirror(id), "ls-tree", "-r", "--name-only", "-z", commit, "--", dir]).then(
      (result) => result.stdout.split("\0").filter((path) => path !== "").sort(),
      () => [],
    );
  }
  async release(id: string, dest: string): Promise<void> {
    await makeWritable(dest);
    await removeWorktree(this.#mirror(id), dest).catch(() => undefined);
    await rm(dest, { recursive: true, force: true });
  }
}

/** Files an agent writes, by agent id; a function receives the job's spec. */
export type AgentFiles = Record<string, (spec: JobSpec) => Record<string, string>>;

/** The mock backend, plus the files a real agent would have written through write. */
export function writingAgentRuntime(files: AgentFiles): AgentRuntime & { specs: JobSpec[] } {
  const mock = createAgentRuntime({ mode: "mock" });
  const specs: JobSpec[] = [];
  return {
    engine: mock.engine,
    specs,
    async startJob(spec: JobSpec): Promise<JobHandle> {
      specs.push(spec);
      for (const [path, content] of Object.entries(files[spec.agent.id]?.(spec) ?? {})) {
        const target = join(spec.workspace.outDir, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
      return mock.startJob(spec);
    },
  };
}
