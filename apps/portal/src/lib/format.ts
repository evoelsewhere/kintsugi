// Display formats shared by every page: timestamps, relative times, durations, sizes and
// short commit ids. One place, so the same value reads the same everywhere.

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 min ago", "in 2 h", "yesterday" — for timelines and "last synced" columns. */
export function formatRelative(iso: string | undefined, now: number = Date.now()): string {
  if (iso === undefined) return "—";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

/** Full local date and time, for titles and detail rows. */
export function formatDateTime(iso: string | undefined): string {
  return iso === undefined ? "—" : new Date(iso).toLocaleString();
}

/** "4m 12s", "1h 03m", "8s" between two instants (the end defaults to now). */
export function formatDuration(startIso: string | undefined, endIso?: string, now: number = Date.now()): string {
  if (startIso === undefined) return "—";
  const ms = Math.max(0, (endIso === undefined ? now : new Date(endIso).getTime()) - new Date(startIso).getTime());
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** "12.4 KB" */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The first 12 characters of a commit id. */
/** One repository a run read, at a commit: the legacy code, or the target code beside it (ADR-0052, ADR-0055). */
export interface SourceRepo {
  repositoryId: string;
  commit?: string;
  role?: "legacy" | "target";
}

/** `repo@abc1234` of each source, comma separated; a source whose commit is not known yet shows its id alone, and a target repository (the to-be) says so. */
export function sourcesLabel(sources: readonly SourceRepo[] | undefined): string {
  return (sources ?? [])
    .map((source) => `${source.commit === undefined ? source.repositoryId : `${source.repositoryId}@${source.commit.slice(0, 12)}`}${source.role === "target" ? " (to-be)" : ""}`)
    .join(", ");
}

/** The `<repository id>@<commit>` entries of an inventory or catalog, shortened the same way. */
export function sourceEntriesLabel(entries: readonly string[] | undefined): string {
  return (entries ?? []).map((entry) => {
    const [repo = "", commit = ""] = entry.split("@");
    return commit === "" ? repo : `${repo}@${commit.slice(0, 12)}`;
  }).join(", ");
}

export function shortSha(sha: string | undefined): string {
  return sha === undefined ? "—" : sha.slice(0, 12);
}

/** The message of an unknown failure. */
export function errorText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
