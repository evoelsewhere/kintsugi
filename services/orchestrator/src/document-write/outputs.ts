// Output rules of the writer (ADR-0019, ADR-0004): what may reach the document repo. Paths
// are relative, without `..` or `.git`; sizes are bounded; a job's /out is read without
// following symbolic links. Paths are then split into auto-commit and pull-request paths.

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAutoCommitPath } from "@kintsugi/domain";
import { type FileChange, type FileWrite, assertSafeRepoPath } from "@kintsugi/git";
import type { DocumentWriteFile } from "../queues.js";

export const OUTPUT_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
} as const;

/** A write broke an output rule; retrying cannot help. */
export class OutputRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputRuleError";
  }
}

const size = (content: string | Uint8Array): number => (typeof content === "string" ? Buffer.byteLength(content) : content.byteLength);

/** Whether an entry removes a file. */
export const isDeleteEntry = (file: FileChange): file is Extract<FileChange, { delete: true }> => "delete" in file && file.delete === true;
/** Whether an entry moves a file; `renameFrom` is then the old path. */
export const isRenameEntry = (file: FileChange): file is Extract<FileChange, { renameFrom: string }> => "renameFrom" in file && typeof file.renameFrom === "string";
/** Every path an entry touches: where it writes, and where it moves from. */
export const pathsOfEntry = (file: FileChange): string[] => (isRenameEntry(file) ? [file.path, file.renameFrom] : [file.path]);

/** Checks paths, duplicates and sizes; returns the files unchanged. */
export function validateOutputs(files: readonly FileChange[], limits = OUTPUT_LIMITS): FileChange[] {
  if (files.length === 0) throw new OutputRuleError("Nothing to write: no files");
  if (files.length > limits.maxFiles) throw new OutputRuleError(`Too many files: ${files.length} (limit ${limits.maxFiles})`);
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    try {
      assertSafeRepoPath(file.path);
    } catch (error) {
      throw new OutputRuleError(error instanceof Error ? error.message : String(error));
    }
    if (seen.has(file.path)) throw new OutputRuleError(`"${file.path}" appears twice`);
    seen.add(file.path);
    if (isRenameEntry(file)) {
      try {
        assertSafeRepoPath(file.renameFrom);
      } catch (error) {
        throw new OutputRuleError(error instanceof Error ? error.message : String(error));
      }
    }
    if (isDeleteEntry(file)) continue;
    const bytes = size(file.content);
    if (bytes > limits.maxFileBytes) throw new OutputRuleError(`"${file.path}" is ${bytes} bytes (limit ${limits.maxFileBytes})`);
    total += bytes;
  }
  if (total > limits.maxTotalBytes) throw new OutputRuleError(`The write is ${total} bytes (limit ${limits.maxTotalBytes})`);
  return [...files];
}

/** Inline files of a request, decoded: a write or an edit, a removal (`delete`) or a move (`renameFrom`). */
export function decodeFiles(files: readonly DocumentWriteFile[]): FileChange[] {
  return files.map((file): FileChange => {
    if (file.delete === true) {
      if (file.expectedHash === undefined) throw new OutputRuleError(`Deleting "${file.path}" needs the hash of the file as it was read`);
      return { path: file.path, delete: true, expectedHash: file.expectedHash };
    }
    const content = file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content;
    if (file.renameFrom !== undefined) {
      if (file.expectedHash === undefined) throw new OutputRuleError(`Moving "${file.renameFrom}" needs the hash of the file as it was read`);
      return { path: file.path, renameFrom: file.renameFrom, content, expectedHash: file.expectedHash };
    }
    return { path: file.path, content, ...(file.expectedHash === undefined ? {} : { expectedHash: file.expectedHash }) };
  });
}

/** Every regular file under a job's output directory; symbolic links and other entries are refused. */
export async function readOutputDir(root: string, limits = OUTPUT_LIMITS): Promise<FileWrite[]> {
  const files: FileWrite[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new OutputRuleError(`"${path}" is a symbolic link`);
      if (stat.isDirectory()) {
        await walk(full, path);
      } else if (stat.isFile()) {
        if (stat.size > limits.maxFileBytes) throw new OutputRuleError(`"${path}" is ${stat.size} bytes (limit ${limits.maxFileBytes})`);
        if (files.length >= limits.maxFiles) throw new OutputRuleError(`Too many files (limit ${limits.maxFiles})`);
        files.push({ path, content: await readFile(full) });
      } else {
        throw new OutputRuleError(`"${path}" is not a regular file`);
      }
    }
  };
  await walk(root, "");
  return files;
}

/** Auto-commit paths go to the default branch; everything else is proposed as a pull request. */
export function splitByAutoCommit<T extends FileChange>(files: readonly T[], autoCommitPaths: readonly string[]): { autoCommit: T[]; review: T[] } {
  const autoCommit: T[] = [];
  const review: T[] = [];
  for (const file of files) (isAutoCommitPath(file.path, autoCommitPaths) ? autoCommit : review).push(file);
  return { autoCommit, review };
}
