// Kintsugi-managed checkout storage (ADR-0025, ADR-0055). Everything lives under one data
// directory chosen at install time (KINTSUGI_DATA_DIR); nobody edits it by hand.
//
//   <data>/git/mirrors/<server-id>/<repo-id>.git   bare mirror per registered repository
//   <data>/git/workspaces/<project-id>/            the writer's scratch worktree of the document repo mirror
//   <data>/jobs/<job-id>/                          one workspace per job, kept across its attempts:
//     WORKSPACE.md      the guide for the agent, generated
//     workspace.json    the manifest (sources, pins, attempt, state), written by the worker
//     as-is/<repo-id>/  legacy repositories, read-only worktrees at their pinned commits
//     to-be/<repo-id>/  target repositories, read-only worktrees at their pinned commits
//     docs/             the declared documents of the document repo at its pinned commit (read-only)
//     out/              the results, laid out like the document repo (the writer copies it)
//     work/             what the steps of a stage pass to each other
//     steps/<step>/     one folder per step of a stage: in/ (a view of docs, work and out), out/ and tmp/
//     .state/           the ledger of finished steps; written by the worker only
//     tmp/              scratch of one attempt; HOME, TEMP and TMPDIR of the job's processes
//
// SSH host keys are not stored here: they live with each Git server and are passed per call.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/** Ids become path segments: letters, digits, `.`, `_`, `-`; no separators, no `..`. */
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function segment(kind: string, value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`Invalid ${kind} "${value}" for checkout storage`);
  return value;
}

/** The folders of one step of a stage (`steps/<step>/`). */
export interface StepPaths {
  root: string;
  /** A read-only view of the stage's documents, work and output so far. */
  in: string;
  out: string;
  tmp: string;
}

export interface JobPaths {
  root: string;
  guide: string;
  manifest: string;
  asIs: string;
  toBe: string;
  docs: string;
  out: string;
  work: string;
  steps: string;
  state: string;
  ledger: string;
  tmp: string;
  /** The folders of a step; the key is a plan step key (`<step id>[#<item>][@<round>]`) or any id. */
  step(key: string): StepPaths;
}

/** A folder name for a step key: readable, safe on every file system, and unique for the key. */
export function stepFolder(key: string): string {
  const slug = key.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 60);
  return `${slug === "" ? "step" : slug}-${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

export class CheckoutStorage {
  readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error(`Checkout storage needs an absolute path, got "${root}"`);
    this.root = root;
  }

  mirror(serverId: string, repoId: string): string {
    return join(this.root, "git", "mirrors", segment("server id", serverId), `${segment("repository id", repoId)}.git`);
  }

  workspace(projectId: string): string {
    return join(this.root, "git", "workspaces", segment("project id", projectId));
  }

  job(jobId: string): JobPaths {
    const root = join(this.root, "jobs", segment("job id", jobId));
    const steps = join(root, "steps");
    const state = join(root, ".state");
    return {
      root,
      guide: join(root, "WORKSPACE.md"),
      manifest: join(root, "workspace.json"),
      asIs: join(root, "as-is"),
      toBe: join(root, "to-be"),
      docs: join(root, "docs"),
      out: join(root, "out"),
      work: join(root, "work"),
      steps,
      state,
      ledger: join(state, "ledger.json"),
      tmp: join(root, "tmp"),
      step: (key) => {
        const folder = join(steps, stepFolder(key));
        return { root: folder, in: join(folder, "in"), out: join(folder, "out"), tmp: join(folder, "tmp") };
      },
    };
  }

  /** Creates the top-level layout; safe to call on every start. */
  async prepare(): Promise<void> {
    for (const dir of [join(this.root, "git", "mirrors"), join(this.root, "git", "workspaces"), join(this.root, "jobs")]) {
      await mkdir(dir, { recursive: true });
    }
  }
}

/** KINTSUGI_DATA_DIR, or `./.kintsugi/data` for development without Docker. */
export function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const configured = env["KINTSUGI_DATA_DIR"];
  return resolve(cwd, configured === undefined || configured === "" ? join(".kintsugi", "data") : configured);
}
