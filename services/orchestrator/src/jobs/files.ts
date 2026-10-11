// File helpers of job workspaces: regular files only (symbolic links and special files are
// refused), relative POSIX paths.

import { copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { JobFailure } from "./model.js";

export interface FileEntry {
  path: string;
  full: string;
  size: number;
}

/** Regular files under `root`, relative POSIX paths, sorted; a missing root has none. */
export async function listFiles(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    for (const name of entries.sort()) {
      const full = join(dir, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new JobFailure(`Output "${path}" is a symbolic link`);
      if (stat.isDirectory()) await walk(full, path);
      else if (stat.isFile()) files.push({ path, full, size: stat.size });
      else throw new JobFailure(`Output "${path}" is not a regular file`);
    }
  };
  await walk(root, "");
  return files;
}

/**
 * Copies the files of `from` into `to`, replacing what is there (a copied input may be
 * read-only, so it is removed first); `select` filters by relative path.
 */
export async function copyTree(from: string, to: string, select?: (path: string) => boolean): Promise<void> {
  for (const file of await listFiles(from)) {
    if (select !== undefined && !select(file.path)) continue;
    const dest = join(to, ...file.path.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await rm(dest, { force: true });
    await copyFile(file.full, dest);
  }
}
