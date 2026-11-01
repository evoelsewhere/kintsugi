// Relative links and anchors of the repository's Markdown, checked without fetching anything: a link's file must exist,
// and its `#anchor` must name a heading of that file (GitHub's slug rule) or an explicit `<a id>` / `<a name>`.
// External URLs (any scheme) are not checked. Used by `pnpm docs:links` (check-doc-links.mjs).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Folders never walked: dependencies, builds, and vendored references that point into their upstream repository. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".turbo", ".claude", ".fleet", ".kintsugi", "coverage"]);
const SKIPPED_PATHS = [`skills${sep}mermaid-diagrams${sep}references`];

/** GitHub's anchor of a heading: lowercase, punctuation dropped (hyphens and underscores kept), spaces to hyphens. */
export function slugOf(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The anchors a Markdown file offers: its headings (repeats numbered as GitHub does) and explicit `<a id|name>`. */
export function anchorsOf(markdown) {
  const anchors = new Set();
  const seen = new Map();
  let fence;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker !== undefined) fence = fence === undefined ? marker : fence === marker ? undefined : fence;
    if (fence !== undefined) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      // HTML tags are dropped outside code spans only: `<rule id>` in backticks is text.
      const text = heading
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .split("`")
        .map((part, index) => (index % 2 === 0 ? part.replace(/<[^>]*>/g, "") : part))
        .join("");
      const base = slugOf(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);
  }
  return anchors;
}

/** The relative links of a Markdown file with their line numbers; code (fenced or inline) and external URLs are left out. */
export function linksOf(markdown) {
  const links = [];
  let fence;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker !== undefined) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
      return;
    }
    if (fence !== undefined) return;
    const text = line.replace(/`[^`]*`/g, "");
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      links.push({ line: index + 1, target });
    }
  });
  return links;
}

/** Every problem of one file's links: `{ line, link, reason }`. `read` returns a file's text, or undefined when it is missing. */
export function checkFile(file, markdown, read) {
  const problems = [];
  for (const { line, target } of linksOf(markdown)) {
    const [pathPart, anchor] = target.split("#", 2);
    const path = decodeURIComponent(pathPart ?? "");
    const resolved = path === "" ? file : resolve(dirname(file), path);
    if (path !== "" && !existsSync(resolved)) {
      problems.push({ line, link: target, reason: "no such file" });
      continue;
    }
    if (anchor === undefined || anchor === "" || !resolved.endsWith(".md") || statSync(resolved).isDirectory()) continue;
    const text = resolved === file ? markdown : read(resolved);
    if (text !== undefined && !anchorsOf(text).has(decodeURIComponent(anchor).toLowerCase())) problems.push({ line, link: target, reason: `no heading or anchor #${anchor}` });
  }
  return problems;
}

/** The Markdown files the check covers: docs/, templates/, the root and every README.md, AGENTS.md and CLAUDE.md. */
export function markdownFiles(root) {
  const files = [];
  const walk = (directory, all) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(root, path);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || SKIPPED_PATHS.some((skipped) => rel.includes(skipped))) continue;
        walk(path, all || rel === "docs" || rel === "templates");
      } else if (entry.name.endsWith(".md") && (all || ["README.md", "AGENTS.md", "CLAUDE.md"].includes(entry.name))) {
        files.push(path);
      }
    }
  };
  walk(root, false);
  return files.sort();
}

/** Checks every covered file; returns the problems as `file:line: <link> -> <reason>`, paths relative to `root`. */
export function checkRepository(root) {
  const cache = new Map();
  const read = (path) => {
    if (!cache.has(path)) cache.set(path, existsSync(path) ? readFileSync(path, "utf8") : undefined);
    return cache.get(path);
  };
  return markdownFiles(root).flatMap((file) =>
    checkFile(file, read(file), read).map((problem) => `${relative(root, file).split(sep).join("/")}:${problem.line}: ${problem.link} -> ${problem.reason}`),
  );
}
