/**
 * Moving or renaming pages without breaking a link (AUT-13, AUT-14, AUT-54, ADR-0098 decision 5). `planMove` is pure: it
 * knows neither Git nor the Brain. The caller reads the pages that can be affected (the pages that move, the pages that
 * link to them and the home pages of the old and the new folders), calls it, and turns the entries into one write: an
 * entry with `renameFrom` for each page that moves and a plain entry for each page whose text changed.
 *
 * Links are read the way the Brain reads them (`MARKDOWN_LINK`, `resolveRelativeLink`), outside code fences and inline
 * code and outside a page's front matter, so a link is rewritten exactly when the Brain resolves it. The text of a link,
 * its `#fragment` (a heading's slug does not change when its page moves), its title and its `<…>` form stay as written.
 */

import { CODE_FENCE, HOME_PAGE_FILES, MARKDOWN_LINK, closesCodeFence, resolveRelativeLink } from "./brain.js";
import { isWikiEditablePath } from "./document-layout.js";

export interface PageMove {
  from: string;
  to: string;
}

export interface PageFile {
  path: string;
  text: string;
}

/** One entry of the write the plan stands for: a page moved (`renameFrom`) or a page whose text changed. */
export interface PageMoveEntry {
  path: string;
  renameFrom?: string;
  text: string;
}

export type PageMoveRefusal =
  /** A file is already at the target and is not moving away. */
  | "target-exists"
  /** A path the wiki may not write (`isWikiEditablePath`), or a move of something that is not a page. */
  | "outside-wiki"
  | "same-path"
  /** A target is the source of another move: a chain or a swap, which one commit cannot do. */
  | "cycle"
  /** The page to move was not handed over. */
  | "missing-source"
  | "duplicate-source";

export type PageMovePlan =
  | { entries: PageMoveEntry[]; rewrittenLinks: number; touched: string[] }
  | { error: PageMoveRefusal; path: string };

/**
 * The Brain's link pattern, also matching an image `![alt](target)`: the Brain does not resolve images, but a page that
 * moves must still find the attachments it shows (ADR-0096 decision 6).
 */
const LINK_OR_IMAGE = MARKDOWN_LINK.source.replace("(?<!!)", "!?");

const isPage = (path: string): boolean => path.toLowerCase().endsWith(".md");

/** The `[start, end)` positions of a line that are inside an inline code span: a run of backticks to the next run as long. */
function codeSpans(line: string): Array<[number, number]> {
  const runs: Array<{ at: number; length: number }> = [];
  for (let at = 0; at < line.length; ) {
    if (line[at] !== "`") {
      at += 1;
      continue;
    }
    let length = 0;
    while (line[at + length] === "`") length += 1;
    runs.push({ at, length });
    at += length;
  }
  const spans: Array<[number, number]> = [];
  for (let index = 0; index < runs.length; index += 1) {
    const open = runs[index];
    const close = runs.slice(index + 1).findIndex((run) => run.length === open?.length);
    if (open === undefined || close < 0) continue;
    const end = runs[index + 1 + close];
    if (end === undefined) continue;
    spans.push([open.at, end.at + end.length]);
    index += 1 + close;
  }
  return spans;
}

/** The index of the first line after a front matter block (0 when the text has none). */
function frontMatterEnd(lines: readonly string[]): number {
  if ((lines[0] ?? "").trim() !== "---") return 0;
  for (let index = 1; index < lines.length && index <= 400; index += 1) if ((lines[index] ?? "").trim() === "---") return index + 1;
  return 0;
}

const parts = (path: string): string[] => path.split("/").filter((segment) => segment !== "");

/** The relative path from the folder of `from` to `to`, as a link writes it. */
function relativePath(from: string, to: string): string {
  const base = parts(from).slice(0, -1);
  const target = parts(to);
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common]) common += 1;
  return [...base.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

/** The characters a bare link target cannot hold: they are written as escapes when the text had none and the target is bare. */
const encodeSegment = (segment: string): string => segment.replace(/[ ()[\]<>%"]/g, (char) => encodeURIComponent(char));

/**
 * The new text of one link target (the part between the parentheses or angle brackets), or undefined when it still
 * points where it did. `at` is where the page is now (`ownerNow`) and `was` where it was; `moved` maps old paths to new.
 */
function rewriteTarget(raw: string, was: string, ownerNow: string, angle: boolean, newPath: (path: string) => string): string | undefined {
  const resolved = resolveRelativeLink(was, raw);
  if (resolved === undefined) return undefined;
  const hash = raw.indexOf("#");
  const beforeHash = hash < 0 ? raw : raw.slice(0, hash);
  const fragment = hash < 0 ? "" : raw.slice(hash);
  const question = beforeHash.indexOf("?");
  const pathPart = question < 0 ? beforeHash : beforeHash.slice(0, question);
  const query = question < 0 ? "" : beforeHash.slice(question);
  if (pathPart === "") return undefined;
  const target = newPath(resolved.path);
  // Nothing moved that this link touches: neither the page nor its target.
  if (target === resolved.path && ownerNow === was) return undefined;
  const absolute = pathPart.startsWith("/");
  // An absolute link (from the repository root) keeps pointing at the same place unless the target itself moved.
  if (absolute && target === resolved.path) return undefined;
  const slash = pathPart.endsWith("/") ? "/" : "";
  let written = absolute ? `/${target}` : relativePath(ownerNow, target);
  if (!absolute && written === "") written = target.split("/").pop() ?? target;
  if (!absolute && pathPart.startsWith("./") && !written.startsWith(".")) written = `./${written}`;
  const escaped = pathPart.includes("%") || (!angle && /[ ()[\]<>"]/.test(written));
  if (escaped) written = written.split("/").map((segment) => (segment === ".." || segment === "." ? segment : encodeSegment(segment))).join("/");
  const next = `${written}${slash}${query}${fragment}`;
  return next === raw ? undefined : next;
}

/** The text with every link that must change rewritten; the number of links it rewrote. */
function rewriteLinks(text: string, was: string, ownerNow: string, newPath: (path: string) => string): { text: string; count: number } {
  const lines = text.split("\n");
  let count = 0;
  let fence: string | undefined;
  const start = frontMatterEnd(lines);
  for (let index = start; index < lines.length; index += 1) {
    const original = lines[index] ?? "";
    const line = original.replace(/\r$/, "");
    const ending = original.slice(line.length);
    const open = CODE_FENCE.exec(line);
    if (fence !== undefined) {
      if (closesCodeFence(line, fence)) fence = undefined;
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      continue;
    }
    if (!line.includes("](")) continue;
    const spans = codeSpans(line);
    const pattern = new RegExp(LINK_OR_IMAGE, "gd");
    let rewritten = "";
    let at = 0;
    for (const match of line.slice(0, 4_000).matchAll(pattern)) {
      const angle = match[2] !== undefined;
      const group = angle ? 2 : 3;
      const raw = match[group];
      const span = match.indices?.[group];
      if (raw === undefined || span === undefined) continue;
      if (spans.some(([from, to]) => match.index >= from && match.index < to)) continue;
      const next = rewriteTarget(raw, was, ownerNow, angle, newPath);
      if (next === undefined) continue;
      rewritten += line.slice(at, span[0]) + next;
      at = span[1];
      count += 1;
    }
    if (at > 0) lines[index] = rewritten + line.slice(at) + ending;
  }
  return { text: lines.join("\n"), count };
}

/** `order:` of a home page's front matter: the names removed, and one added at the end; nothing happens without an `order:` list. */
function editOrder(text: string, remove: readonly string[], add: string | undefined): string {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return text;
  const end = frontMatterEnd(lines);
  if (end === 0) return text;
  const key = lines.findIndex((line, index) => index > 0 && index < end - 1 && /^order:/.test(line));
  if (key < 0) return text;
  const carriage = (lines[key] ?? "").endsWith("\r") ? "\r" : "";
  const bare = (item: string): string => item.trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\/+$/, "");
  const drops = (item: string): boolean => remove.includes(bare(item));
  const quoted = (name: string): string => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`);
  const inline = /^order:[ \t]*\[(.*)\][ \t]*\r?$/.exec(lines[key] ?? "");
  if (inline?.[1] !== undefined) {
    const kept = inline[1].split(",").map((item) => item.trim()).filter((item) => item !== "" && !drops(item));
    if (add !== undefined && !kept.some((item) => bare(item) === add)) kept.push(quoted(add));
    lines[key] = `order: [${kept.join(", ")}]${carriage}`;
    return lines.join("\n");
  }
  if (!/^order:[ \t]*\r?$/.test(lines[key] ?? "")) return text;
  let last = key;
  const items: Array<{ line: number; name: string; indent: string }> = [];
  for (let index = key + 1; index < end - 1; index += 1) {
    const item = /^([ \t]*)-[ \t]+(.*?)\r?$/.exec(lines[index] ?? "");
    if (item?.[2] === undefined) break;
    items.push({ line: index, name: item[2], indent: item[1] ?? "  " });
    last = index;
  }
  const indent = items[0]?.indent ?? "  ";
  const kept = items.filter((item) => !drops(item.name));
  const additions = add !== undefined && !kept.some((item) => bare(item.name) === add) ? [`${indent}- ${quoted(add)}${carriage}`] : [];
  const block = [...kept.map((item) => lines[item.line] ?? ""), ...additions];
  lines.splice(key + 1, last - key, ...block);
  return lines.join("\n");
}

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Plans the moves of pages. `files` holds every page the plan may change: the pages that move, the pages that link to
 * them, and the home page (`README.md` or `index.md`) of the old and of the new folder of each page when they have one.
 * A refusal is a value, not an exception. The result is deterministic: the moved pages first by new path, then the
 * pages that were only rewritten by path, each once.
 */
export function planMove(input: { moves: readonly PageMove[]; files: readonly PageFile[] }): PageMovePlan {
  const sources = new Map<string, string>();
  for (const move of input.moves) {
    if (move.from === move.to) return { error: "same-path", path: move.from };
    if (!isWikiEditablePath(move.from) || !isWikiEditablePath(move.to) || !isPage(move.from) || !isPage(move.to)) return { error: "outside-wiki", path: !isWikiEditablePath(move.to) || !isPage(move.to) ? move.to : move.from };
    if (sources.has(move.from)) return { error: "duplicate-source", path: move.from };
    sources.set(move.from, move.to);
  }
  const given = new Map(input.files.map((file) => [file.path, file.text]));
  const targets = new Set<string>();
  for (const [from, to] of sources) {
    if (!given.has(from)) return { error: "missing-source", path: from };
    if (sources.has(to)) return { error: "cycle", path: to };
    if (targets.has(to) || given.has(to)) return { error: "target-exists", path: to };
    targets.add(to);
  }
  const newPath = (path: string): string => sources.get(path) ?? path;

  const out = new Map<string, { text: string; renameFrom?: string }>();
  let rewrittenLinks = 0;
  for (const file of input.files) {
    const result = rewriteLinks(file.text, file.path, newPath(file.path), newPath);
    rewrittenLinks += result.count;
    out.set(file.path, { text: result.text });
  }

  // The home pages of the folders a page leaves and joins: its name leaves the old `order`, and joins the new one.
  const homeOf = (folder: string): string | undefined => HOME_PAGE_FILES.map((name) => (folder === "" ? name : `${folder}/${name}`)).find((path) => [...out.keys()].some((candidate) => candidate.toLowerCase() === path.toLowerCase()));
  const resolveHome = (folder: string): string | undefined => {
    const wanted = homeOf(folder);
    return wanted === undefined ? undefined : [...out.keys()].find((candidate) => candidate.toLowerCase() === wanted.toLowerCase());
  };
  for (const [from, to] of sources) {
    const oldName = nameOf(from);
    const oldHome = resolveHome(folderOf(from));
    const newHome = resolveHome(folderOf(to));
    const bare = oldName.replace(/\.md$/i, "");
    if (oldHome !== undefined && oldHome !== from) {
      const entry = out.get(oldHome);
      if (entry !== undefined) entry.text = editOrder(entry.text, [oldName, bare], undefined);
    }
    if (newHome !== undefined && newHome !== to) {
      const entry = out.get(newHome);
      if (entry !== undefined) entry.text = editOrder(entry.text, [], nameOf(to).replace(/\.md$/i, ""));
    }
  }

  const entries: PageMoveEntry[] = [];
  const moved = [...sources].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  for (const [from, to] of moved) entries.push({ path: to, renameFrom: from, text: out.get(from)?.text ?? given.get(from) ?? "" });
  for (const file of [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (sources.has(file.path)) continue;
    const text = out.get(file.path)?.text ?? file.text;
    if (text !== file.text) entries.push({ path: file.path, text });
  }
  const touched = [...new Set([...sources.keys(), ...sources.values(), ...entries.map((entry) => entry.path)])].sort();
  return { entries, rewrittenLinks, touched };
}
