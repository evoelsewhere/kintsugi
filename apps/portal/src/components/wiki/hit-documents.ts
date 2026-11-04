// The document nodes of the pages a search found. A grep match is the deepest section or card a line is in, and those
// hold neither the page's space nor its labels, so the results look the pages up (`brain/lookup` by path, as the page
// view does). One lookup per page and commit is kept: the same page found by another search is not asked for again.

import type { BrainNode } from "@kintsugi/domain";
import { brainApi } from "@/lib/api/brain";
import { wikiRead } from "@/lib/wiki";

const known = new Map<string, Promise<BrainNode | undefined>>();

function documentOf(projectId: string, commit: string, path: string): Promise<BrainNode | undefined> {
  const key = `${projectId}\n${commit}\n${path}`;
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  const lookup = wikiRead(() => brainApi.lookup(projectId, path))
    .then((found) => found.matches.find((match) => match.kind === "document" && match.path === path))
    // A page that cannot be looked up stays a result without its attributes; ask again next time.
    .catch(() => {
      known.delete(key);
      return undefined;
    });
  known.set(key, lookup);
  return lookup;
}

/** The document node of each path that could be looked up, by path. */
export async function documentsOf(projectId: string, commit: string, paths: readonly string[]): Promise<Map<string, BrainNode>> {
  const nodes = await Promise.all(paths.map((path) => documentOf(projectId, commit, path)));
  const found = new Map<string, BrainNode>();
  nodes.forEach((node, index) => {
    const path = paths[index];
    if (node !== undefined && path !== undefined) found.set(path, node);
  });
  return found;
}
