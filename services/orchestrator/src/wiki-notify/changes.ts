// What changed in the wiki between two commits of the default branch, read from the mirror (ADR-0099 decision 3): the pages
// that were added, edited, deleted or renamed, the page id of each, and who made the changes. Only names, ids and the
// people behind the commits are read; nothing of a page's text leaves this module except the id in its front matter.

import { randomBytes } from "node:crypto";
import { isWikiEditablePath, pageIdOf } from "@kintsugi/domain";
import { runGit } from "@kintsugi/git";

/** The most pages one run tells about; the others are left out and logged. */
export const WIKI_NOTIFY_PAGE_LIMIT = 200;

export interface PageChange {
  /** The page as it is at `to`, or as it was at `from` when it was deleted. */
  path: string;
  kind: "added" | "modified" | "deleted" | "renamed";
  /** The path before a rename. */
  oldPath?: string;
  /** The page's id (`PAGE-…`), from its front matter at `to` (at `from` for a deleted page); undefined when it has none. */
  pageId?: string;
  /** The blob to read the id from. */
  blob: string;
}

/** A Markdown page the wiki writes: what a watcher is told about. */
const isWatchedPage = (path: string): boolean => path.toLowerCase().endsWith(".md") && isWikiEditablePath(path);

/** The pages that changed between `from` and `to`, in path order, and how many were left out over the limit. */
export async function changedPages(mirror: string, from: string, to: string): Promise<{ changes: PageChange[]; cut: number }> {
  // `--raw -z`: `:<mode> <mode> <old blob> <new blob> <status>\0<path>[\0<new path>]`, so the blob of each change is known.
  const { stdout } = await runGit(["--git-dir", mirror, "diff", "--raw", "-z", "--no-abbrev", "-M", from, to], { timeoutMs: 2 * 60 * 1000 });
  const tokens = stdout.split("\0");
  const changes: PageChange[] = [];
  for (let at = 0; at < tokens.length; ) {
    const head = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(tokens[at] ?? "");
    if (head === null) {
      at += 1;
      continue;
    }
    const [, oldBlob = "", newBlob = "", status = ""] = head;
    const first = tokens[at + 1] ?? "";
    const second = status === "R" || status === "C" ? (tokens[at + 2] ?? "") : undefined;
    at += second === undefined ? 2 : 3;
    if (status === "D") {
      if (isWatchedPage(first)) changes.push({ path: first, kind: "deleted", blob: oldBlob });
    } else if (status === "R" && second !== undefined) {
      if (isWatchedPage(second)) changes.push({ path: second, kind: isWatchedPage(first) ? "renamed" : "added", ...(isWatchedPage(first) ? { oldPath: first } : {}), blob: newBlob });
      else if (isWatchedPage(first)) changes.push({ path: first, kind: "deleted", blob: oldBlob });
    } else if (status === "A" || status === "C") {
      const path = second ?? first;
      if (isWatchedPage(path)) changes.push({ path, kind: "added", blob: newBlob });
    } else if (status === "M" || status === "T") {
      if (isWatchedPage(first)) changes.push({ path: first, kind: "modified", blob: newBlob });
    }
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const kept = changes.slice(0, WIKI_NOTIFY_PAGE_LIMIT);
  const ids = await pageIdsOf(mirror, kept.map((change) => change.blob));
  return { changes: kept.map((change) => ({ ...change, ...(ids.get(change.blob) === undefined ? {} : { pageId: ids.get(change.blob) }) })), cut: changes.length - kept.length };
}

/** The page id of each blob (the first `id:` of its front matter), read in one `cat-file` call; a blob that has none is missing from the map. */
async function pageIdsOf(mirror: string, blobs: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const unique = [...new Set(blobs)];
  if (unique.length === 0) return found;
  const marker = `@@kintsugi-notify-${randomBytes(12).toString("hex")}@@`;
  const { stdout } = await runGit(["--git-dir", mirror, "cat-file", `--batch=${marker} %(objectname) %(objecttype)`], { input: `${unique.join("\n")}\n`, timeoutMs: 2 * 60 * 1000 });
  for (const part of stdout.split(`${marker} `).slice(1)) {
    const newline = part.indexOf("\n");
    const [blob, type] = part.slice(0, newline).split(" ");
    if (blob === undefined || type !== "blob") continue;
    const id = pageIdOf(part.slice(newline + 1));
    if (id !== undefined) found.set(blob, id);
  }
  return found;
}

/** Who made the changes of a path: the people behind the commits that touched it, as the commit says (never resolved to an account here). */
export interface ChangeAuthors {
  /** `Kintsugi-Actor` trailers: a user name or an id, the value Kintsugi wrote for the person on whose behalf it committed. */
  actors: Set<string>;
  /** Author e-mail addresses in lower case: commits pushed from a member's own clone. */
  emails: Set<string>;
  /** The commits themselves: a pull request merged later is matched to its write by them. */
  commits: Set<string>;
}

/** For each path, the authors of the commits in `from..to` that touched it. */
export async function authorsOfChanges(mirror: string, from: string, to: string): Promise<Map<string, ChangeAuthors>> {
  const marker = `@@kintsugi-authors-${randomBytes(8).toString("hex")}@@`;
  // `--no-renames` lists the old and the new path of a rename in the commit, so both have the author.
  const { stdout } = await runGit(
    ["--git-dir", mirror, "log", "-z", "--no-renames", "--name-only", `--format=${marker}%H%x1f%ae%x1f%(trailers:key=Kintsugi-Actor,valueonly,separator=%x1e)`, `${from}..${to}`],
    { timeoutMs: 2 * 60 * 1000 },
  );
  const authors = new Map<string, ChangeAuthors>();
  let current: { commit: string; email: string; actors: string[] } | undefined;
  for (const token of stdout.split("\0")) {
    const field = token.startsWith("\n") ? token.slice(1) : token;
    if (field.startsWith(marker)) {
      const [commit = "", email = "", actors = ""] = field.slice(marker.length).split("\x1f");
      current = { commit, email: email.trim().toLowerCase(), actors: actors.split("\x1e").map((actor) => actor.trim()).filter((actor) => actor !== "") };
      continue;
    }
    if (current === undefined || field === "") continue;
    const entry = authors.get(field) ?? { actors: new Set<string>(), emails: new Set<string>(), commits: new Set<string>() };
    for (const actor of current.actors) entry.actors.add(actor);
    if (current.email !== "") entry.emails.add(current.email);
    entry.commits.add(current.commit);
    authors.set(field, entry);
  }
  return authors;
}
