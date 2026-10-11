// Job workspace helpers (ADR-0029). A job sees its source checkout and inputs read-only and
// writes only to its output and scratch directories. There is no OS-level sandbox: the
// read-only bit is set on every file and directory (on Windows only files honour it), the
// kernel confines agent tools to the workspace and script steps get a cleared environment.

import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const READ_ONLY_FILE = 0o444;
const READ_ONLY_DIR = 0o555;
const WRITABLE_FILE = 0o644;
const WRITABLE_DIR = 0o755;

/** Walks `root` without following symbolic links; directories are visited after their content. */
async function walk(root: string, visit: (path: string, kind: "file" | "dir" | "other") => Promise<void>): Promise<void> {
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) return visit(root, "other");
  if (!stat.isDirectory()) return visit(root, stat.isFile() ? "file" : "other");
  for (const entry of await readdir(root)) await walk(join(root, entry), visit);
  await visit(root, "dir");
}

/** Marks every file and directory under `root` read-only (symbolic links are left alone). */
export async function makeReadOnly(root: string): Promise<void> {
  await walk(root, async (path, kind) => {
    if (kind === "file") await chmod(path, READ_ONLY_FILE);
    else if (kind === "dir") await chmod(path, READ_ONLY_DIR);
  });
}

/** Restores write permission under `root`, so the workspace can be removed. */
export async function makeWritable(root: string): Promise<void> {
  // Directories first (top-down), so their entries can be listed and changed.
  const fix = async (path: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      await chmod(path, WRITABLE_DIR);
      for (const entry of await readdir(path)) await fix(join(path, entry));
    } else if (stat.isFile()) {
      await chmod(path, WRITABLE_FILE);
    }
  };
  await fix(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

/** Removes a workspace directory, read-only parts included. */
export async function removeTree(root: string): Promise<void> {
  await makeWritable(root);
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}

export interface TreeSize {
  files: number;
  bytes: number;
}

/** Regular files and their total size under `root` (symbolic links are not followed). */
export async function treeSize(root: string): Promise<TreeSize> {
  const size: TreeSize = { files: 0, bytes: 0 };
  await walk(root, async (path, kind) => {
    if (kind !== "file") return;
    size.files += 1;
    size.bytes += (await lstat(path)).size;
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  return size;
}
