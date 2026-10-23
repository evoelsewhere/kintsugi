// The repositories a run reads (ADR-0052, ADR-0055). An application may link several `legacy`
// repositories (the as-is) and several `target` ones (the to-be); a run mounts each one read-only
// in its own folder, `as-is/<repository id>/` or `to-be/<repository id>/`, so a file is cited as
// `<repository id>/<path in the repository>` and the folder of one repository never hides a file of
// another. A run pins the commit of every repository.

/** What a repository of a run is: the code being replaced, or the code that replaces it. */
export type SourceRole = "legacy" | "target";

/** One repository of a run; `commit` is known once the run has resolved it. A source recorded without a role is `legacy`. */
export interface SourceRepo {
  repositoryId: string;
  commit?: string;
  role?: SourceRole;
}

/** The zone folder of a workspace a role is mounted under. */
export const SOURCE_ZONES = { legacy: "as-is", target: "to-be" } as const satisfies Record<SourceRole, string>;

/** A source whose commit is resolved and whose role is explicit. */
export type PinnedSource = Required<SourceRepo>;

export const sourceRole = (source: SourceRepo): SourceRole => source.role ?? "legacy";

/** The legacy repositories of a run, in mount order. */
export const legacySources = <T extends SourceRepo>(sources: readonly T[]): T[] => sources.filter((source) => sourceRole(source) === "legacy");

/** The target repositories of a run, in mount order. */
export const targetSources = <T extends SourceRepo>(sources: readonly T[]): T[] => sources.filter((source) => sourceRole(source) === "target");

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
export function parseSourceSpec(text: string): PinnedSource[] | undefined {
  const sources: PinnedSource[] = [];
  for (const part of text.split(",")) {
    const [repositoryId, commit, ...rest] = part.trim().split("@");
    if (rest.length > 0 || repositoryId === undefined || commit === undefined || !SOURCE_FOLDER_PATTERN.test(repositoryId) || !COMMIT.test(commit)) return undefined;
    if (sources.some((source) => source.repositoryId === repositoryId)) return undefined;
    sources.push({ repositoryId, commit, role: "legacy" });
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
