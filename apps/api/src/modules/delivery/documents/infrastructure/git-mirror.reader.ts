// Reads the document repo mirror under the data directory (ADR-0025) with the git CLI of
// packages/git: plumbing commands only (for-each-ref, ls-tree, cat-file), never a checkout,
// never a write, never a network call. The worker keeps the mirror current.

import { access } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { CheckoutStorage, GitError, dataDirFromEnv, runGit, runGitBytes } from "@kintsugi/git";
import type { BytesRead, DiffFile, DocumentDiff, DocumentRepo, FileRead, FileVersion, GrepLine, MirrorBranch, RecentCommit, TreeEntry } from "../domain/document.js";
import { DocumentRepoReader } from "../domain/document.ports.js";

const TIMEOUT_MS = 30_000;
/** The most commits the recent changes read: the newest ones that changed a Markdown file. */
const RECENT_SCAN_MAX = 2_000;
/** The most versions of one file the history reads: the newest ones. */
const HISTORY_SCAN_MAX = 2_000;

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

  async readBytes(repo: DocumentRepo, commit: string, path: string, maxBytes: number): Promise<BytesRead> {
    const type = await this.objectType(repo, commit, path);
    if (type === undefined) return { status: "missing" };
    if (type !== "blob") return { status: "not-a-file" };
    const size = Number((await this.git(repo, ["cat-file", "-s", `${commit}:${path}`])).trim());
    if (size > maxBytes) return { status: "too-large", size };
    // The blob's bytes, never decoded as text; the output is bounded by the size just read.
    const bytes = await runGitBytes(["--git-dir", this.storage.mirror(repo.serverId, repo.repositoryId), "cat-file", "blob", `${commit}:${path}`], { timeoutMs: TIMEOUT_MS, maxOutputBytes: size + 1024 });
    return { status: "ok", size, bytes };
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

  async patch(repo: DocumentRepo, from: string, to: string, path: string): Promise<string> {
    // The path is literal (no glob); no external diff driver or text conversion runs on the repository's attributes.
    return this.git(repo, ["-c", "core.quotePath=false", "--literal-pathspecs", "diff", "--unified=3", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", from, to, "--", path]);
  }

  async grep(repo: DocumentRepo, commit: string, terms: readonly string[], options: { ignoreCase: boolean; under?: string; only?: ReadonlySet<string>; limit: number }): Promise<{ matches: GrepLine[]; truncated: boolean }> {
    // Fixed strings over the Markdown files only: their blobs are in the mirror, and a pattern cannot backtrack.
    // Several terms must all be on the same line.
    const patterns = terms.flatMap((term, index) => [...(index === 0 ? [] : ["--and"]), "-e", term]);
    const args = ["grep", "-z", "-n", "-I", "-F", "--full-name", ...(options.ignoreCase ? ["-i"] : []), ...patterns, commit, "--", markdownPathspec(options.under ?? "")];
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
      const path = location.slice(commit.length + 1);
      // Only the files the caller asked for count toward the limit, so a filter never loses a page to other pages' lines.
      if (options.only !== undefined && !options.only.has(path)) continue;
      if (matches.length === options.limit) {
        truncated = true;
        break;
      }
      matches.push({ path, line: Number(line), text: rest.join("\0") });
    }
    return { matches, truncated };
  }

  async diff(repo: DocumentRepo, from: string, to: string, under: string | undefined): Promise<DocumentDiff | undefined> {
    const resolved = (await this.git(repo, ["rev-parse", "--verify", "-q", "--end-of-options", `${from}^{commit}`]).catch(() => "")).trim();
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(resolved)) return undefined;
    const scope = under ?? "";
    const within = (path: string): boolean => scope === "" || path === scope || path.startsWith(`${scope}/`);
    // Which files changed needs trees only, which a partial mirror always has. All Markdown files are compared, so a
    // document moved into or out of the scope is seen as moved rather than as added or deleted.
    const names = await this.git(repo, ["diff", "--name-status", "-z", "-M", resolved, to, "--", markdownPathspec("")]);
    const files = new Map<string, DiffFile>();
    const tokens = names.split("\0");
    for (let index = 0; index < tokens.length; ) {
      const status = tokens[index++] ?? "";
      if (status === "") continue;
      if (status.startsWith("R")) {
        const previous = tokens[index++] ?? "";
        const path = tokens[index++] ?? "";
        if (within(path) || within(previous)) files.set(path, { path, previousPath: previous, status: "renamed", added: 0, removed: 0, hunks: [] });
      } else {
        const path = tokens[index++] ?? "";
        const kind = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
        if (within(path)) files.set(path, { path, previousPath: null, status: kind, added: 0, removed: 0, hunks: [] });
      }
    }
    if (files.size === 0) return { from: resolved, files: [], linesKnown: true };
    // Which lines changed needs the text of both commits; an older text the mirror never fetched leaves them unknown.
    // A move across the scope needs both of its paths in the patch.
    const crossing = [...files.values()].some((file) => file.previousPath !== null && !(within(file.path) && within(file.previousPath)));
    let linesKnown = true;
    try {
      const patch = await this.git(repo, ["-c", "core.quotePath=false", "diff", "--unified=0", "--no-color", "-M", resolved, to, "--", markdownPathspec(crossing ? "" : scope)]);
      let current: DiffFile | undefined;
      let removedPath: string | undefined;
      let header = false;
      for (const line of patch.split("\n")) {
        // A file's header runs from its `diff --git` line to its first hunk; a changed line that looks like a
        // header line (an added "++ x") is text.
        if (line.startsWith("diff --git ")) {
          header = true;
          current = undefined;
          removedPath = undefined;
        } else if (header && line.startsWith("--- ")) removedPath = patchPath(line.slice(4));
        else if (header && line.startsWith("+++ ")) current = files.get(patchPath(line.slice(4)) ?? removedPath ?? "");
        else if (line.startsWith("@@")) {
          header = false;
          const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
          if (hunk === null || current === undefined) continue;
          const removed = hunk[1] === undefined ? 1 : Number(hunk[1]);
          const start = Number(hunk[2]);
          const count = hunk[3] === undefined ? 1 : Number(hunk[3]);
          current.removed += removed;
          current.added += count;
          // Lines only removed are placed on the line after which they were.
          if (current.status !== "deleted") current.hunks.push(count > 0 ? { start, end: start + count - 1 } : { start: Math.max(start, 1), end: Math.max(start, 1) });
        }
      }
    } catch {
      linesKnown = false;
    }
    return { from: resolved, files: [...files.values()], linesKnown };
  }

  async recent(repo: DocumentRepo, commit: string): Promise<RecentCommit[]> {
    // `-z --name-status -M`: after a commit's fields come NUL-separated entries, a status and one path (two for a rename).
    const format = ["%H", "%aI", "%an", "%ae", "%s", "%(trailers:only,unfold)"].join("%x1f");
    const out = await this.git(repo, ["log", "-z", "--name-status", "-M", `-n${RECENT_SCAN_MAX}`, `--format=%x1e${format}%x1f`, commit, "--", markdownPathspec("")]);
    const commits: RecentCommit[] = [];
    for (const record of out.split("\x1e")) {
      if (record.trim() === "") continue;
      const [header = "", ...tokens] = record.split("\0");
      const [sha = "", date = "", authorName = "", authorEmail = "", subject = "", trailers = ""] = header.trim().split("\x1f");
      if (sha === "") continue;
      const trailer = (key: string): string | undefined => {
        for (const line of trailers.split("\n")) {
          const colon = line.indexOf(":");
          if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === key) return line.slice(colon + 1).trim();
        }
        return undefined;
      };
      const files: DiffFile[] = [];
      for (let at = 0; at < tokens.length; ) {
        const code = (tokens[at] ?? "").trim();
        if (code === "") {
          at += 1;
          continue;
        }
        const pair = code.startsWith("R") || code.startsWith("C");
        const first = tokens[at + 1] ?? "";
        const second = pair ? (tokens[at + 2] ?? "") : "";
        at += pair ? 3 : 2;
        const status: DiffFile["status"] = code.startsWith("R") ? "renamed" : code.startsWith("D") ? "deleted" : code.startsWith("A") || code.startsWith("C") ? "added" : "modified";
        // A copy is a new file; a rename names the old path first and the new one second.
        if (code.startsWith("R")) files.push({ path: second, previousPath: first, status, added: 0, removed: 0, hunks: [] });
        else files.push({ path: pair ? second : first, previousPath: null, status, added: 0, removed: 0, hunks: [] });
      }
      if (files.length === 0) continue;
      const actor = trailer("kintsugi-actor");
      commits.push({ sha, date: new Date(date).toISOString(), subject, authorName, authorEmail, trailerActor: actor === "" ? undefined : actor, trailerMinor: trailer("kintsugi-minor")?.toLowerCase() === "true", files });
    }
    return commits;
  }

  async history(repo: DocumentRepo, commit: string, path: string, options: { limit: number; before?: string }): Promise<{ entries: FileVersion[]; more: boolean }> {
    // The whole history of the file (up to HISTORY_SCAN_MAX versions) is read from the tip each time: `--follow` follows
    // a rename only from the commit that has the path, so a page cannot start at an older commit under the new name.
    // The path is literal (no glob). Fields end with a unit separator, a record with a record separator.
    const format = ["%H", "%aI", "%an", "%ae", "%s", "%(trailers:only,unfold)"].join("%x1f");
    const out = await this.git(repo, ["--literal-pathspecs", "log", "--follow", `-n${HISTORY_SCAN_MAX}`, `--format=${format}%x1e`, commit, "--", path]);
    const entries: FileVersion[] = [];
    for (const record of out.split("\x1e")) {
      const [sha = "", date = "", authorName = "", authorEmail = "", subject = "", trailers = ""] = record.trim().split("\x1f");
      if (sha === "") continue;
      const trailer = (key: string): string | undefined => {
        for (const line of trailers.split("\n")) {
          const colon = line.indexOf(":");
          if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === key) return line.slice(colon + 1).trim();
        }
        return undefined;
      };
      const actor = trailer("kintsugi-actor");
      entries.push({ sha, date: new Date(date).toISOString(), subject, authorName, authorEmail, trailerActor: actor === "" ? undefined : actor, trailerMinor: trailer("kintsugi-minor")?.toLowerCase() === "true" });
    }
    // The page starts after `before` when it is given (none when `before` is not a version of this file).
    const from = options.before === undefined ? 0 : entries.findIndex((entry) => entry.sha === options.before) + 1;
    if (options.before !== undefined && from === 0) return { entries: [], more: false };
    return { entries: entries.slice(from, from + options.limit), more: entries.length > from + options.limit };
  }

  private async objectType(repo: DocumentRepo, commit: string, path: string): Promise<string | undefined> {
    const out = await this.git(repo, ["cat-file", "-t", `${commit}:${path}`]).catch(() => "");
    return out.trim() === "" ? undefined : out.trim();
  }
}

/**
 * The Markdown files under a folder, or one document, as a pathspec. Glob characters of the path match themselves
 * (each in a class of its own: a backslash would be a path separator on Windows), and the extension matches in any
 * case, as the Brain indexes it.
 */
export function markdownPathspec(under: string): string {
  const literal = under.replace(/[[*?]/g, (char) => `[${char}]`);
  return `:(glob)${under === "" ? "**/*.[mM][dD]" : under.toLowerCase().endsWith(".md") ? literal : `${literal}/**/*.[mM][dD]`}`;
}

/**
 * The path of a patch's `---` or `+++` line without its `a/` or `b/`: git ends a path holding a space with a tab and
 * quotes one with special characters C-style. Undefined for `/dev/null`.
 */
export function patchPath(raw: string): string | undefined {
  let path = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  if (path === "/dev/null") return undefined;
  if (path.length > 1 && path.startsWith('"') && path.endsWith('"')) path = unquoteC(path.slice(1, -1));
  return path.replace(/^[ab]\//, "");
}

const C_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

/** Undoes git's C-style quoting, whose octal escapes are the bytes of UTF-8 text. */
function unquoteC(quoted: string): string {
  const bytes: number[] = [];
  for (let at = 0; at < quoted.length; at += 1) {
    const char = quoted[at] ?? "";
    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const next = quoted[at + 1] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(quoted.slice(at + 1, at + 4), 8));
      at += 3;
    } else {
      bytes.push(...Buffer.from(C_ESCAPES[next] ?? next));
      at += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
