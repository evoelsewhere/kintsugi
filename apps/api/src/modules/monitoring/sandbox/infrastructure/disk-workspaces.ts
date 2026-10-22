// The job workspaces on the data volume, read-only (ADR-0058). What cannot be made again is measured with a bound: a
// workspace holds thousands of files (its checkouts are left out), and listing must stay quick.

import { Injectable } from "@nestjs/common";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CheckoutStorage, dataDirFromEnv } from "@kintsugi/git";
import { type DiskWorkspace, JOB_ID, WorkspaceDisk, type WorkspaceLifecycle } from "../domain/sandbox.js";

/** Folders a retry makes again from the pins in the manifest. */
const CHECKOUTS = ["as-is", "to-be", "docs"];
const MAX_ENTRIES = 20_000;
const LIFECYCLES: readonly string[] = ["running", "parked", "published"];

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Bytes of the regular files under `root`, skipping `skip` at its top; stops after `MAX_ENTRIES` entries. */
async function measure(root: string, skip: readonly string[]): Promise<{ bytes: number; truncated: boolean }> {
  let bytes = 0;
  let seen = 0;
  const pending: string[] = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (dir === root && skip.includes(entry.name)) continue;
      if (++seen > MAX_ENTRIES) return { bytes, truncated: true };
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) bytes += (await lstat(path).catch(() => undefined))?.size ?? 0;
    }
  }
  return { bytes, truncated: false };
}

const sourceLabel = (source: Record<string, unknown>): string => `${String(source["role"] ?? "legacy")}:${String(source["repositoryId"] ?? "")}@${String(source["commit"] ?? "").slice(0, 8)}`;

@Injectable()
export class DiskWorkspaces extends WorkspaceDisk {
  readonly #storage = new CheckoutStorage(dataDirFromEnv());

  get #jobsDir(): string {
    return join(this.#storage.root, "jobs");
  }

  async list(): Promise<DiskWorkspace[]> {
    const names = await readdir(this.#jobsDir).catch((error: unknown) => {
      if (isMissing(error)) return [] as string[];
      throw error;
    });
    const found: DiskWorkspace[] = [];
    for (const jobId of names.filter((name) => JOB_ID.test(name))) {
      const root = this.#storage.job(jobId).root;
      const stat = await lstat(root).catch(() => undefined);
      if (stat?.isDirectory() !== true) continue;
      const manifest = await readFile(join(root, "workspace.json"), "utf8").then((text) => JSON.parse(text) as Record<string, unknown>, () => undefined);
      const entries = await readdir(root).catch(() => [] as string[]);
      const results = await measure(root, CHECKOUTS);
      const state = manifest?.["state"];
      const attempt = manifest?.["attempt"];
      found.push({
        jobId,
        modifiedAt: stat.mtime.toISOString(),
        ...(typeof state === "string" && LIFECYCLES.includes(state) ? { lifecycle: state as WorkspaceLifecycle } : {}),
        ...(typeof attempt === "number" ? { attempt } : {}),
        sources: Array.isArray(manifest?.["sources"]) ? (manifest["sources"] as Array<Record<string, unknown>>).map(sourceLabel) : [],
        hasCheckouts: CHECKOUTS.some((name) => entries.includes(name)) && manifest?.["checkoutsDroppedAt"] === undefined,
        resultsBytes: results.bytes,
        ...(results.truncated ? { resultsBytesTruncated: true } : {}),
      });
    }
    return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async exists(jobId: string): Promise<boolean> {
    if (!JOB_ID.test(jobId)) return false;
    return (await lstat(this.#storage.job(jobId).root).catch(() => undefined))?.isDirectory() === true;
  }
}
