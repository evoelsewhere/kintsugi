// Reads the document repo mirror under the data directory (ADR-0025) with the git CLI of
// packages/git: plumbing commands only (for-each-ref, ls-tree, cat-file), never a checkout,
// never a write, never a network call. The worker keeps the mirror current.

import { access } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { CheckoutStorage, GitError, dataDirFromEnv, runGit } from "@kintsugi/git";
import type { DocumentRepo, FileRead, GrepLine, MirrorBranch, TreeEntry } from "../domain/document.js";
import { DocumentRepoReader } from "../domain/document.ports.js";

const TIMEOUT_MS = 30_000;

@Injectable()
export class GitMirrorDocumentReader extends DocumentRepoReader {
  private readonly storage = new CheckoutStorage(dataDirFromEnv());

  private git(repo: DocumentRepo, args: string[]): Promise<string> {
    return runGit(["--git-dir", this.storage.mirror(repo.serverId, repo.repositoryId), ...args], { timeoutMs: TIMEOUT_MS }).then((result) => result.stdout);
  }

  async available(repo: DocumentRepo): Promise<boolean> {
    return access(this.storage.mirror(repo.serverId, repo.repositoryId)).then(
      () => true,
      () => false,
    );
  }

  async headBranch(repo: DocumentRepo): Promise<string | undefined> {
    const ref = (await this.git(repo, ["symbolic-ref", "-q", "HEAD"]).catch(() => "")).trim();
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined;
  }

  async branches(repo: DocumentRepo): Promise<MirrorBranch[]> {
    const out = await this.git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)", "refs/heads/"]);
    return out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [ref = "", commit = "", date = ""] = line.split("\0");
        return { name: ref.slice("refs/heads/".length), commit, date: new Date(date).toISOString() };
      });
  }

  async branchTip(repo: DocumentRepo, branch: string): Promise<string | undefined> {
    const out = await this.git(repo, ["rev-parse", "--verify", "-q", "--end-of-options", `refs/heads/${branch}^{commit}`]).catch(() => "");
    return out.trim() === "" ? undefined : out.trim();
  }

  async hasCommit(repo: DocumentRepo, commit: string): Promise<boolean> {
    return this.git(repo, ["cat-file", "-e", `${commit}^{commit}`]).then(
      () => true,
      () => false,
    );
  }

  async isAncestor(repo: DocumentRepo, ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) return false;
      throw error;
    }
  }

  async list(repo: DocumentRepo, commit: string, path: string): Promise<TreeEntry[] | undefined> {
    if (path !== "" && (await this.objectType(repo, commit, path)) !== "tree") return undefined;
    // `<commit>:<path>` names the directory's own tree, so the entries are its children.
    const out = await this.git(repo, ["ls-tree", "-l", "-z", `${commit}:${path}`]);
    const entries: TreeEntry[] = [];
    for (const record of out.split("\0")) {
      const match = /^(\d+) (blob|tree|commit) [0-9a-f]+\s+(-|\d+)\t(.+)$/s.exec(record);
      if (match === null || match[2] === "commit") continue; // submodules are not content
      const name = match[4]!;
      const kind = match[2] === "tree" ? "dir" : "file";
      entries.push({ path: path === "" ? name : `${path}/${name}`, name, kind, ...(kind === "file" ? { size: Number(match[3]) } : {}) });
    }
    return entries;
  }

  async read(repo: DocumentRepo, commit: string, path: string, maxBytes: number, knownSize?: number): Promise<FileRead> {
    let size = knownSize;
    if (size === undefined) {
      const type = await this.objectType(repo, commit, path);
      if (type === undefined) return { status: "missing" };
      if (type !== "blob") return { status: "not-a-file" };
      size = Number((await this.git(repo, ["cat-file", "-s", `${commit}:${path}`])).trim());
    }
    if (size > maxBytes) return { status: "too-large", size };
    const content = await this.git(repo, ["cat-file", "blob", `${commit}:${path}`]);
    if (content.includes("\0")) return { status: "binary", size };
    return { status: "ok", size, content };
  }

  async grep(repo: DocumentRepo, commit: string, terms: readonly string[], options: { ignoreCase: boolean; under?: string; limit: number }): Promise<{ matches: GrepLine[]; truncated: boolean }> {
    // Fixed strings over the Markdown files only: their blobs are in the mirror, and a pattern cannot backtrack.
    // Several terms must all be on the same line.
    const under = options.under ?? "";
    const pathspec = under === "" ? "**/*.md" : under.toLowerCase().endsWith(".md") ? under : `${under}/**/*.md`;
    const patterns = terms.flatMap((term, index) => [...(index === 0 ? [] : ["--and"]), "-e", term]);
    const args = ["grep", "-z", "-n", "-I", "-F", "--full-name", ...(options.ignoreCase ? ["-i"] : []), ...patterns, commit, "--", `:(glob)${pathspec}`];
    const out = await this.git(repo, args).catch((error: unknown) => {
      // Exit status 1 is "no match".
      if (error instanceof GitError && error.exitCode === 1) return "";
      throw error;
    });
    const matches: GrepLine[] = [];
    let truncated = false;
    for (const record of out.split("\n")) {
      if (record === "") continue;
      const [location, line, ...rest] = record.split("\0");
      if (location === undefined || line === undefined) continue;
      if (matches.length === options.limit) {
        truncated = true;
        break;
      }
      matches.push({ path: location.slice(commit.length + 1), line: Number(line), text: rest.join("\0") });
    }
    return { matches, truncated };
  }

  private async objectType(repo: DocumentRepo, commit: string, path: string): Promise<string | undefined> {
    const out = await this.git(repo, ["cat-file", "-t", `${commit}:${path}`]).catch(() => "");
    return out.trim() === "" ? undefined : out.trim();
  }
}
