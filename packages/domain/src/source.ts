// The legacy repositories a run reads (ADR-0052). An application may link several `legacy`
// repositories; a run mounts each one read-only in its own folder under `src/`, named by the
// repository's id, so a file is cited as `<repository id>/<path in the repository>` and the folder
// of one repository never hides a file of another. A run pins the commit of every repository.

/** One legacy repository of a run; `commit` is known once the run has resolved it. */
export interface SourceRepo {
  repositoryId: string;
  commit?: string;
}

/** A repository id is also the folder it is mounted in: one safe path segment. */
export const SOURCE_FOLDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The folder a repository is mounted in, under the run's `src/`. */
export function sourceFolder(repositoryId: string): string {
  if (!SOURCE_FOLDER_PATTERN.test(repositoryId)) throw new Error(`"${repositoryId}" cannot name a source folder`);
  return repositoryId;
}

/**
 * The sources as a spec, `id@commit,id@commit`, which scripts take as one argument and documents record as
 * provenance. Every source must have a commit.
 */
export function sourceSpec(sources: readonly SourceRepo[]): string {
  return sources
    .map((source) => {
      if (source.commit === undefined || !COMMIT.test(source.commit)) throw new Error(`source ${source.repositoryId} has no commit`);
      return `${sourceFolder(source.repositoryId)}@${source.commit}`;
    })
    .join(",");
}

/** The sources of a spec; undefined when the text is not a well-formed spec. */
export function parseSourceSpec(text: string): Array<Required<SourceRepo>> | undefined {
  const sources: Array<Required<SourceRepo>> = [];
  for (const part of text.split(",")) {
    const [repositoryId, commit, ...rest] = part.trim().split("@");
    if (rest.length > 0 || repositoryId === undefined || commit === undefined || !SOURCE_FOLDER_PATTERN.test(repositoryId) || !COMMIT.test(commit)) return undefined;
    if (sources.some((source) => source.repositoryId === repositoryId)) return undefined;
    sources.push({ repositoryId, commit });
  }
  return sources.length === 0 ? undefined : sources;
}

/** `<repository id>/<path>` of a file of a source repository. */
export function sourcePath(repositoryId: string, path: string): string {
  return `${sourceFolder(repositoryId)}/${path}`;
}

/** The repository and the path inside it of a cited `<repository id>/<path>`, if its first segment is one of `sources`. */
export function splitSourcePath(cited: string, sources: readonly SourceRepo[]): { repositoryId: string; path: string } | undefined {
  const slash = cited.indexOf("/");
  if (slash <= 0) return undefined;
  const repositoryId = cited.slice(0, slash);
  return sources.some((source) => source.repositoryId === repositoryId) ? { repositoryId, path: cited.slice(slash + 1) } : undefined;
}
