// Why a registered repository could not be synced (ADR-0025), in words a person can act on. The
// worker records Git's own message; the known ones are said plainly, everything else is kept.

/** What a person sees for a repository with no commits. */
export const EMPTY_REPOSITORY_MESSAGE = "The repository is empty (no commits yet)";

const MISSING_REVISION = /rev-parse --verify(?: --end-of-options)? (\S+)\^\{commit\}[\s\S]*Needed a single revision/;

/** The sync error as the portal shows it: a known Git failure in plain words, else the recorded text. */
export function describeSyncError(raw: string): string {
  const missing = MISSING_REVISION.exec(raw);
  if (missing === null) return raw;
  const ref = missing[1] ?? "";
  // HEAD resolves to nothing only when the repository has no commit; a named branch may just not exist.
  if (ref === "HEAD") return EMPTY_REPOSITORY_MESSAGE;
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  return `The branch ${branch} has no commit in the repository (it is empty or the branch does not exist)`;
}
