// Kintsugi-managed checkout storage (ADR-0025). Everything lives under one data
// directory chosen at install time (KINTSUGI_DATA_DIR); nobody edits it by hand.
//
//   <data>/git/mirrors/<server-id>/<repo-id>.git   bare mirror per registered repository
//   <data>/git/workspaces/<project-id>/            the worker's clone of the workspace repo
//   <data>/jobs/<job-id>/src                       per-job worktree at a fixed commit (mounted read-only)
//   <data>/jobs/<job-id>/out                       per-job output
//   <data>/ssh/known_hosts                         pinned SSH host keys

import { mkdir, open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/** Ids become path segments: letters, digits, `.`, `_`, `-`; no separators, no `..`. */
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function segment(kind: string, value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`Invalid ${kind} "${value}" for checkout storage`);
  return value;
}

export interface JobPaths {
  root: string;
  src: string;
  out: string;
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
    return { root, src: join(root, "src"), out: join(root, "out") };
  }

  get knownHosts(): string {
    return join(this.root, "ssh", "known_hosts");
  }

  /** Creates the top-level layout; safe to call on every start. */
  async prepare(): Promise<void> {
    for (const dir of [join(this.root, "git", "mirrors"), join(this.root, "git", "workspaces"), join(this.root, "jobs"), join(this.root, "ssh")]) {
      await mkdir(dir, { recursive: true });
    }
    await (await open(this.knownHosts, "a", 0o600)).close();
  }
}

/** KINTSUGI_DATA_DIR, or `./.kintsugi/data` for development without Docker. */
export function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const configured = env["KINTSUGI_DATA_DIR"];
  return resolve(cwd, configured === undefined || configured === "" ? join(".kintsugi", "data") : configured);
}
