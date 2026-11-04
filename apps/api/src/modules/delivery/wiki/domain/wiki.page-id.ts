// The id line of a page's front matter (ADR-0096 decision 4). Pure.

import { isPageId, pageIdOf } from "@kintsugi/domain";

/** How many lines of front matter are read for an `id:` line (as `pageIdOf` does). */
const FRONT_MATTER_MAX_LINES = 400;

/**
 * The text with the `id:` of its front matter replaced by `id`, every other byte (line endings included) as it was;
 * undefined when the text carries no page id in its front matter, or `id` is not a page id.
 */
export function withPageId(markdown: string, id: string): string | undefined {
  if (!isPageId(id) || pageIdOf(markdown) === undefined) return undefined;
  const lines = markdown.split("\n");
  for (let index = 1; index < lines.length && index <= FRONT_MATTER_MAX_LINES; index += 1) {
    const line = lines[index] ?? "";
    if (line.replace(/\r$/, "").trim() === "---") return undefined;
    if (!/^id:[ \t]*(.*)$/.test(line.replace(/\r$/, ""))) continue;
    lines[index] = `id: ${id}${line.endsWith("\r") ? "\r" : ""}`;
    const replaced = lines.join("\n");
    return pageIdOf(replaced) === id ? replaced : undefined;
  }
  return undefined;
}
