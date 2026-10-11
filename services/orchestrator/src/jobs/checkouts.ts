// Read-only source checkouts for job runs (ADR-0025, ADR-0029): the registered repository's
// mirror is brought up to date, the job's commit is checked out as a detached worktree and
// every file is marked read-only. The worktree is removed when the run ends.

import { rm } from "node:fs/promises";
import { CheckoutStorage, addWorktree, assertSafeRepoPath, removeWorktree, runGit } from "@kintsugi/git";
import { makeReadOnly, makeWritable } from "@kintsugi/runtime/launcher";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { remoteOptions, syncRepository } from "../git-sync/sync.js";
import { JobFailure, type SourceCheckouts } from "./model.js";

export class MirrorCheckouts implements SourceCheckouts {
  constructor(private readonly deps: { repositories: RepositoryStore; storage: CheckoutStorage }) {}

  async resolve(repositoryId: string): Promise<string> {
    const result = await syncRepository({ store: this.deps.repositories, storage: this.deps.storage }, repositoryId);
    if (result === undefined) throw new JobFailure(`Repository ${repositoryId} is no longer registered`);
    return result.commit;
  }

  async checkout(repositoryId: string, commit: string, dest: string): Promise<void> {
    const target = await this.deps.repositories.target(repositoryId);
    if (target === undefined) throw new JobFailure(`Repository ${repositoryId} is no longer registered`);
    await addWorktree(this.deps.storage.mirror(target.serverId, target.id), dest, commit, remoteOptions(target));
    await makeReadOnly(dest);
  }

  async readDocument(repositoryId: string, commit: string, path: string): Promise<string | undefined> {
    assertSafeRepoPath(path);
    const target = await this.deps.repositories.target(repositoryId);
    if (target === undefined) throw new JobFailure(`Repository ${repositoryId} is no longer registered`);
    const mirror = this.deps.storage.mirror(target.serverId, target.id);
    return runGit(["--git-dir", mirror, "show", `${commit}:${path}`], remoteOptions(target)).then(
      (result) => result.stdout,
      () => undefined,
    );
  }

  async release(repositoryId: string, dest: string): Promise<void> {
    await makeWritable(dest);
    const target = await this.deps.repositories.target(repositoryId);
    if (target !== undefined) {
      await removeWorktree(this.deps.storage.mirror(target.serverId, target.id), dest).catch(() => undefined);
    }
    await rm(dest, { recursive: true, force: true, maxRetries: 3 });
  }
}
