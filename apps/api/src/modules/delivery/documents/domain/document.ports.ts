// Port of document repo reads: the mirror Kintsugi keeps of a project's document repository
// (ADR-0025), read-only. Implemented over the git CLI (packages/git).

import type { DocumentRepo, FileRead, GrepLine, MirrorBranch, TreeEntry } from "./document.js";

export abstract class DocumentRepoReader {
  /** Whether the mirror exists (the worker clones it on the first sync). */
  abstract available(repo: DocumentRepo): Promise<boolean>;
  /** The branch the mirror's HEAD points to (without refs/heads/), when it has one. */
  abstract headBranch(repo: DocumentRepo): Promise<string | undefined>;
  /** Every branch of the mirror with its tip. */
  abstract branches(repo: DocumentRepo): Promise<MirrorBranch[]>;
  /** The commit a branch points to; undefined when the branch does not exist. */
  abstract branchTip(repo: DocumentRepo, branch: string): Promise<string | undefined>;
  /** Whether the mirror has this commit. */
  abstract hasCommit(repo: DocumentRepo, commit: string): Promise<boolean>;
  /** Whether `ancestor` is reachable from `descendant`. */
  abstract isAncestor(repo: DocumentRepo, ancestor: string, descendant: string): Promise<boolean>;
  /** The entries of a directory at a commit (`""` is the root); undefined when it is not a directory. */
  abstract list(repo: DocumentRepo, commit: string, path: string): Promise<TreeEntry[] | undefined>;
  /**
   * A text file at a commit, refused when larger than `maxBytes` or binary. `knownSize` (from a
   * listing of its directory at the same commit) saves looking the file up first.
   */
  abstract read(repo: DocumentRepo, commit: string, path: string, maxBytes: number, knownSize?: number): Promise<FileRead>;
  /**
   * The lines of the Markdown files at a commit that contain every one of `terms` (fixed strings, not patterns),
   * under `under` when given; at most `limit` lines, and whether more matched.
   */
  abstract grep(repo: DocumentRepo, commit: string, terms: readonly string[], options: { ignoreCase: boolean; under?: string; limit: number }): Promise<{ matches: GrepLine[]; truncated: boolean }>;
}
