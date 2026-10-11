// Output rules of the writer (ADR-0019, ADR-0004): what may reach the document repo. Paths
// are relative, without `..` or `.git`; sizes are bounded; a job's /out is read without
// following symbolic links. Paths are then split into auto-commit and pull-request paths.

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAutoCommitPath } from "@kintsugi/domain";
import { type FileWrite, assertSafeRepoPath } from "@kintsugi/git";
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

/** Checks paths, duplicates and sizes; returns the files unchanged. */
export function validateOutputs(files: readonly FileWrite[], limits = OUTPUT_LIMITS): FileWrite[] {
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
    const bytes = size(file.content);
    if (bytes > limits.maxFileBytes) throw new OutputRuleError(`"${file.path}" is ${bytes} bytes (limit ${limits.maxFileBytes})`);
    total += bytes;
  }
  if (total > limits.maxTotalBytes) throw new OutputRuleError(`The write is ${total} bytes (limit ${limits.maxTotalBytes})`);
  return [...files];
}

/** Inline files of a request, decoded. */
export function decodeFiles(files: readonly DocumentWriteFile[]): FileWrite[] {
  return files.map((file) => ({ path: file.path, content: file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content }));
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
export function splitByAutoCommit(files: readonly FileWrite[], autoCommitPaths: readonly string[]): { autoCommit: FileWrite[]; review: FileWrite[] } {
  const autoCommit: FileWrite[] = [];
  const review: FileWrite[] = [];
  for (const file of files) (isAutoCommitPath(file.path, autoCommitPaths) ? autoCommit : review).push(file);
  return { autoCommit, review };
}
