/**
 * Making a new page (AUT-11, DIS-30, ADR-0096 decisions 3 and 4, ADR-0098): its address from a title, the scope of its id,
 * and the text it starts from when a template is chosen. All pure: the API reads the template and the Brain and calls
 * these.
 *
 * `pageFromTemplate` is the standard of "round trip byte for byte": the editor never normalises text, so a page published
 * unchanged is exactly what this function returned.
 */

import { isPageKey } from "./document-layout.js";

/** The longest slug of a page's file name. */
export const PAGE_SLUG_MAX = 60;

/** The scope of the ids of pages that sit in no space (the numbered folders of the project itself). */
export const PAGE_DEFAULT_SCOPE = "DOC";

/**
 * A page's file name from its title: lower case, letters folded to `a-z` (accents and `đ` removed), every other run of
 * characters one `-`, none at the ends, at most 60 characters. Undefined when nothing is left, so the title cannot name a
 * page.
 */
export function pageSlug(title: string): string | undefined {
  const folded = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D").toLowerCase();
  const slug = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, PAGE_SLUG_MAX).replace(/-+$/g, "");
  return slug === "" ? undefined : slug;
}

/**
 * The path of a new page in `folder`: `<folder>/<slug>.md`, then `<slug>-2.md`, `<slug>-3.md` while `taken` says the path
 * is. Undefined when the title or the folder cannot name a page. A folder is the plain path of a folder, no trailing slash.
 */
export function newPagePath(folder: string, title: string, taken: (path: string) => boolean): string | undefined {
  const slug = pageSlug(title);
  const clean = folder.replace(/\/+$/, "");
  if (slug === undefined || clean === "") return undefined;
  for (let number = 1; number <= 1000; number += 1) {
    const name = number === 1 ? slug : `${slug.slice(0, PAGE_SLUG_MAX - `-${number}`.length).replace(/-+$/g, "")}-${number}`;
    const path = `${clean}/${name}.md`;
    if (!taken(path)) return path;
  }
  return undefined;
}

/** The scope of the ids of the pages of a space (its key), or `DOC` outside any space. */
export function pageIdScope(spaceKey: string | null | undefined): string {
  const key = (spaceKey ?? "").trim().toUpperCase();
  return isPageKey(key) ? key : PAGE_DEFAULT_SCOPE;
}

/** Control characters and line separators: a title is one line. */
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]+", "g");

/** The text of a front matter value: plain when YAML reads it back unchanged, else a double-quoted JSON string. */
function yamlText(value: string): string {
  const line = value.replace(CONTROL, " ").trim();
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} .,()_/&'-]*$/u.test(line) && !/[ ]$/.test(line) && !/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(line) && !/^[0-9.+-]+$/.test(line);
  return plain ? line : JSON.stringify(line);
}

/** Whether a front matter line starts the key `name` (`id: x`, `id:`), not a key that merely begins with it. */
const isKey = (line: string, name: string): boolean => new RegExp(`^${name}:([ \\t]|$)`).test(line.replace(/\r$/, ""));

/** A line that belongs to the value above it: indented, or a list item of a block. */
const continues = (line: string): boolean => /^([ \t]+\S|[ \t]*-[ \t])/.test(line);

/** Whether the line is `type: template`, quoted or not, which is what makes a page a template. */
function isTypeTemplate(line: string): boolean {
  const match = /^type:[ \t]*(["']?)template\1[ \t]*(#.*)?\r?$/i.exec(line);
  return match !== null;
}

/**
 * The text a new page starts from when it is made out of a template: in the front matter `id:` and `title:` are set (in
 * place when the template has them, else added right after the opening `---`, `id:` first), and the lines `template:` and
 * `type: template` are removed so the page is not a template itself. Every other byte stays: the order of the keys,
 * comments, the text, the line endings. A template without front matter gets a block with the two lines in front of its
 * text.
 */
export function pageFromTemplate(templateText: string, page: { id: string; title: string }): string {
  const idLine = `id: ${page.id}`;
  const titleLine = `title: ${yamlText(page.title)}`;
  const lines = templateText.split("\n");
  const crlf = (lines[0] ?? "").endsWith("\r");
  const eol = crlf ? "\r" : "";
  const withEol = (text: string): string => `${text}${eol}`;
  if (lines[0]?.replace(/\r$/, "") !== "---") return `${withEol("---")}\n${withEol(idLine)}\n${withEol(titleLine)}\n${withEol("---")}\n${templateText}`;

  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").replace(/\r$/, "") === "---") {
      close = index;
      break;
    }
  }
  // An unclosed block is not front matter: the text starts with its own `---`, kept, after a block of its own.
  if (close < 0) return `${withEol("---")}\n${withEol(idLine)}\n${withEol(titleLine)}\n${withEol("---")}\n${templateText}`;

  const body: string[] = [];
  let hasId = false;
  let hasTitle = false;
  for (let index = 1; index < close; index += 1) {
    const line = lines[index] ?? "";
    if (isKey(line, "template") || isTypeTemplate(line) || (isKey(line, "id") && hasId) || (isKey(line, "title") && hasTitle)) {
      while (continues(lines[index + 1] ?? "") && index + 1 < close) index += 1;
      continue;
    }
    if (isKey(line, "id")) {
      hasId = true;
      body.push(withEol(idLine));
      while (continues(lines[index + 1] ?? "") && index + 1 < close) index += 1;
      continue;
    }
    if (isKey(line, "title")) {
      hasTitle = true;
      body.push(withEol(titleLine));
      while (continues(lines[index + 1] ?? "") && index + 1 < close) index += 1;
      continue;
    }
    body.push(line);
  }
  const added = [...(hasId ? [] : [withEol(idLine)]), ...(hasTitle ? [] : [withEol(titleLine)])];
  return [lines[0] ?? "", ...added, ...body, ...lines.slice(close)].join("\n");
}
