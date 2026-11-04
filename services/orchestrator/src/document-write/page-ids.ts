// The writer's last check on page ids (ADR-0096 decision 4, ADR-0098 decision 6): a write whose pages give an id that
// another file of the default branch already holds is refused whole, so two pages never share an id. The API checks
// too, but the writer does not trust it.

import { pageIdOf } from "@kintsugi/domain";
import { OutputRuleError } from "./outputs.js";

const textOf = (content: string | Uint8Array): string => (typeof content === "string" ? content : Buffer.from(content).toString("utf8"));

/** What the check reads of an entry of a write: a page, a move (`renameFrom`) or a removal (`delete`). */
export type PageWriteEntry = { path: string; content: string | Uint8Array; renameFrom?: string } | { path: string; delete: true };

const isRemoval = (file: PageWriteEntry): file is { path: string; delete: true } => "delete" in file && file.delete === true;
const sourceOf = (file: PageWriteEntry): string | undefined => ("renameFrom" in file ? file.renameFrom : undefined);

/**
 * Throws an `OutputRuleError` ("Page id X is already defined by <path>") for the first page of the write whose front
 * matter id is held by a file that the write does not replace. The same id at the page's own path (an edit) or at its
 * `renameFrom` (a move) is the page itself, and a file the write removes or moves away frees its id. Two pages of one
 * write that give the same id refuse each other. `findOwners` returns the paths that hold an id at the head of the default branch.
 */
export async function assertNoDuplicatePageIds(files: readonly PageWriteEntry[], findOwners: (id: string) => Promise<readonly string[]>): Promise<void> {
  const removed = new Set(files.flatMap((file) => (isRemoval(file) ? [file.path] : sourceOf(file) === undefined ? [] : [sourceOf(file) as string])));
  const given = new Map<string, string>();
  for (const file of files) {
    if (isRemoval(file) || !file.path.toLowerCase().endsWith(".md")) continue;
    const id = pageIdOf(textOf(file.content));
    if (id === undefined) continue;
    const other = given.get(id);
    if (other !== undefined) throw new OutputRuleError(`Page id ${id} is given by two pages of this write: ${other} and ${file.path}`);
    given.set(id, file.path);
    const own = new Set([file.path, sourceOf(file)].filter((path): path is string => path !== undefined));
    const owner = (await findOwners(id)).find((path) => !own.has(path) && !removed.has(path));
    if (owner !== undefined) throw new OutputRuleError(`Page id ${id} is already defined by ${owner}`);
  }
}
