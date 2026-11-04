// Which files of a commit define a page id (ADR-0096 decision 4): the writer refuses a page whose id another file
// already holds, so two pages never share an id.

import { pageIdOf } from "@kintsugi/domain";
import { GitError, runGit } from "./cli.js";

/** The most files read to check one id: a repository that holds more than this many copies of an id is broken anyway. */
const MAX_CANDIDATES = 50;

/**
 * The Markdown files of `commit` whose front matter gives `id` as their page id, in path order. A line of a page's text
 * that quotes the id does not count: only the front matter does. `mirror` is a bare repository (a mirror).
 */
export async function findPageIdOwners(mirror: string, commit: string, id: string): Promise<string[]> {
  if (!/^PAGE-[A-Z][A-Z0-9]{1,9}-[0-9]{4,9}$/.test(id)) throw new GitError(`"${id}" is not a page id`, null, "");
  const listed = await runGit(["--git-dir", mirror, "grep", "-l", "-z", "-I", "-F", "-e", id, commit, "--", ":(glob)**/*.[mM][dD]"]).then(
    (result) => result.stdout,
    (error: unknown) => {
      // Exit status 1 is "no match".
      if (error instanceof GitError && error.exitCode === 1) return "";
      throw error;
    },
  );
  // `git grep <commit>` names each file `<commit>:<path>`.
  const prefix = `${commit}:`;
  const paths = listed
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => (entry.startsWith(prefix) ? entry.slice(prefix.length) : entry))
    .sort()
    .slice(0, MAX_CANDIDATES);
  const owners: string[] = [];
  for (const path of paths) {
    const text = await runGit(["--git-dir", mirror, "show", `${commit}:${path}`]).then(
      (result) => result.stdout,
      () => undefined,
    );
    if (text !== undefined && pageIdOf(text) === id) owners.push(path);
  }
  return owners;
}
