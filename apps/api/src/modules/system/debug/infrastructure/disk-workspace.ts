// The job workspaces on the data volume, read-only (ADR-0056, ADR-0055). A path is resolved inside the job's folder
// and refused when it leaves it, by name or by a link; a file is read in bounded pieces.

import { Injectable } from "@nestjs/common";
import { lstat, open, readFile, readdir, realpath, statfs } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CheckoutStorage, dataDirFromEnv } from "@kintsugi/git";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { type FileText, type Json, type TreeEntry, WorkspaceFiles } from "../domain/debug.js";

const JOB_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MAX_READ = 100_000;

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

@Injectable()
export class DiskWorkspaceFiles extends WorkspaceFiles {
  readonly #storage = new CheckoutStorage(dataDirFromEnv());

  get #jobsDir(): string {
    return join(this.#storage.root, "jobs");
  }

  async jobs(limit: number): Promise<Array<{ id: string; modifiedAt: string; entries: string[]; manifest?: Json }>> {
    const names = await readdir(this.#jobsDir).catch((error: unknown) => {
      if (isMissing(error)) return [] as string[];
      throw error;
    });
    const found: Array<{ id: string; modifiedAt: Date }> = [];
    for (const id of names) {
      if (!JOB_ID.test(id)) continue;
      const stat = await lstat(join(this.#jobsDir, id)).catch(() => undefined);
      if (stat?.isDirectory() === true) found.push({ id, modifiedAt: stat.mtime });
    }
    found.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    const result: Array<{ id: string; modifiedAt: string; entries: string[]; manifest?: Json }> = [];
    for (const entry of found.slice(0, limit)) {
      const root = this.#storage.job(entry.id).root;
      const manifest = await readFile(join(root, "workspace.json"), "utf8").then((text) => JSON.parse(text) as Json, () => undefined);
      result.push({ id: entry.id, modifiedAt: entry.modifiedAt.toISOString(), entries: (await readdir(root).catch(() => [])).sort(), ...(manifest === undefined ? {} : { manifest }) });
    }
    return result;
  }

  async exists(jobId: string): Promise<boolean> {
    if (!JOB_ID.test(jobId)) return false;
    return (await lstat(this.#storage.job(jobId).root).catch(() => undefined))?.isDirectory() === true;
  }

  /** The real path of `path` inside the job's folder; throws when it is not inside, or not there. */
  async #inside(jobId: string, path: string): Promise<{ root: string; full: string }> {
    if (!JOB_ID.test(jobId)) throw new BadRequestException(`"${jobId}" is not a job id`);
    const root = this.#storage.job(jobId).root;
    const realRoot = await realpath(root).catch((error: unknown) => {
      if (isMissing(error)) throw new NotFoundException(`No workspace for job ${jobId} on this server`);
      throw error;
    });
    const wanted = resolve(realRoot, path.replace(/^[/\\]+/, ""));
    const outside = (candidate: string): boolean => {
      const rel = relative(realRoot, candidate);
      return rel.startsWith("..") || isAbsolute(rel);
    };
    if (outside(wanted)) throw new BadRequestException("The path leaves the job's workspace");
    const real = await realpath(wanted).catch((error: unknown) => {
      if (isMissing(error)) throw new NotFoundException(`${path === "" ? "." : path} is not in the workspace of job ${jobId}`);
      throw error;
    });
    if (outside(real)) throw new BadRequestException("The path leaves the job's workspace (a link points out of it)");
    return { root: realRoot, full: real };
  }

  async tree(jobId: string, path: string, depth: number, limit: number): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const { root, full } = await this.#inside(jobId, path);
    const entries: TreeEntry[] = [];
    let truncated = false;
    const rel = (target: string): string => relative(root, target).split(sep).join("/");
    const walk = async (dir: string, left: number): Promise<void> => {
      const names = (await readdir(dir).catch(() => [])).sort();
      for (const name of names) {
        if (entries.length >= limit) {
          truncated = true;
          return;
        }
        const target = join(dir, name);
        const stat = await lstat(target).catch(() => undefined);
        if (stat === undefined) continue;
        if (stat.isSymbolicLink()) entries.push({ path: rel(target), type: "link" });
        else if (stat.isFile()) entries.push({ path: rel(target), type: "file", size: stat.size });
        else if (stat.isDirectory()) {
          // A repository's own metadata and dependency folders are listed, not entered.
          const enter = left > 1 && name !== ".git" && name !== "node_modules";
          if (enter) {
            entries.push({ path: `${rel(target)}/`, type: "dir" });
            await walk(target, left - 1);
          } else entries.push({ path: `${rel(target)}/`, type: "dir", entries: (await readdir(target).catch(() => [])).length });
        } else entries.push({ path: rel(target), type: "other" });
      }
    };
    const start = await lstat(full);
    if (start.isFile()) return { entries: [{ path: rel(full), type: "file", size: start.size }], truncated: false };
    await walk(full, depth);
    return { entries, truncated };
  }

  async read(jobId: string, path: string, offset: number, length: number): Promise<FileText> {
    const { root, full } = await this.#inside(jobId, path);
    const stat = await lstat(full);
    if (!stat.isFile()) throw new BadRequestException(`${path} is not a file`);
    const want = Math.min(length, MAX_READ);
    const handle = await open(full, "r");
    try {
      const buffer = Buffer.alloc(Math.min(want, Math.max(0, stat.size - offset)));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const chunk = buffer.subarray(0, bytesRead);
      const common = { path: relative(root, full).split(sep).join("/"), size: stat.size, offset, length: bytesRead, truncated: offset + bytesRead < stat.size };
      if (chunk.subarray(0, 8192).includes(0)) return { ...common, binary: true };
      return { ...common, binary: false, text: chunk.toString("utf8") };
    } finally {
      await handle.close();
    }
  }

  async state(jobId: string): Promise<{ manifest?: unknown; ledger?: unknown; stepFolders: string[] }> {
    const paths = this.#storage.job(jobId);
    if (!(await this.exists(jobId))) throw new NotFoundException(`No workspace for job ${jobId} on this server`);
    const parse = (file: string): Promise<unknown> => readFile(file, "utf8").then((text) => JSON.parse(text) as unknown, () => undefined);
    const manifest = await parse(paths.manifest);
    const ledger = await parse(paths.ledger);
    return { ...(manifest === undefined ? {} : { manifest }), ...(ledger === undefined ? {} : { ledger }), stepFolders: (await readdir(paths.steps).catch(() => [])).sort() };
  }

  async disk(): Promise<Json> {
    const stats = await statfs(this.#storage.root).catch(() => undefined);
    const jobs = await readdir(this.#jobsDir).catch(() => []);
    return {
      dataDir: this.#storage.root,
      jobWorkspaces: jobs.length,
      ...(stats === undefined ? {} : { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) }),
    };
  }
}
