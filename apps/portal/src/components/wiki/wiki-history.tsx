// The history of a page: the commits that changed it, newest first, renames followed. A version opens as the page
// looked then; two picked versions are compared. The list loads fifty at a time and says when there are older ones.

import { GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { CheckMark } from "@/components/ui/checkbox";
import { documentsApi, type HistoryEntry } from "@/lib/api/documents";
import { errorText, formatDateTime, shortSha } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { comparePair, togglePicked, wikiPageLink, wikiRead } from "@/lib/wiki";

export interface WikiHistoryProps {
  projectId: string;
  /** The commit the Brain indexed: the history is of the page up to it. */
  commit: string;
  path: string;
}

export function WikiHistory({ projectId, commit, path }: WikiHistoryProps): React.JSX.Element {
  const first = useLoader(`wiki/${projectId}/${commit}/history/${path}`, () => wikiRead(() => documentsApi.history(projectId, path, { ref: commit })));
  return (
    <Loaded loader={first} rows={5}>
      {(history) => <Versions key={history.commit} projectId={projectId} commit={commit} path={path} first={history.entries} firstNext={history.next} />}
    </Loaded>
  );
}

function Versions({ projectId, commit, path, first, firstNext }: WikiHistoryProps & { first: HistoryEntry[]; firstNext: string | null }): React.JSX.Element {
  const navigate = useNavigate();
  const [older, setOlder] = useState<{ entries: HistoryEntry[]; next: string | null }>({ entries: [], next: firstNext });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const entries = [...first, ...older.entries];

  const loadOlder = async (): Promise<void> => {
    if (older.next === null) return;
    setLoading(true);
    setFailure(null);
    try {
      const page = await wikiRead(() => documentsApi.history(projectId, path, { ref: commit, before: older.next ?? undefined }));
      setOlder((current) => ({ entries: [...current.entries, ...page.entries], next: page.next }));
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  const [a, b] = picked;
  const compare = (): void => {
    if (a === undefined || b === undefined) return;
    void navigate(wikiPageLink(projectId, path, { mode: "compare", ...comparePair(entries.map((entry) => entry.sha), a, b) }));
  };

  if (entries.length === 0) {
    return <p className="py-6 text-center text-[13px] text-text-muted">No commit changed this page yet.</p>;
  }
  return (
    <section aria-label="Versions of the page" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-muted">
          {entries.length} {entries.length === 1 ? "version" : "versions"}
          {older.next === null ? "" : " so far"} · pick two to compare them
        </p>
        <Button size="small" variant="solid" disabled={picked.length !== 2} onClick={compare}>
          <GitCompareArrows />
          Compare
        </Button>
      </div>
      <ol className="flex flex-col gap-px">
        {entries.map((entry, index) => {
          const isPicked = picked.includes(entry.sha);
          return (
            <li key={entry.sha} className={cn("flex items-start gap-3 rounded-[var(--geist-radius)] px-2 py-2", isPicked && "bg-hover")}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isPicked}
                aria-label={`Pick the version ${shortSha(entry.sha)} to compare`}
                className="mt-0.5 rounded-[4px] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                onClick={() => setPicked((current) => togglePicked(current, entry.sha))}
              >
                <CheckMark checked={isPicked} />
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link to={wikiPageLink(projectId, path, index === 0 ? { mode: "page" } : { mode: "version", sha: entry.sha })} className="text-[13px] text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                  {entry.subject === "" ? "(no comment)" : entry.subject}
                </Link>
                <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                  <span>{entry.actor}</span>
                  <time dateTime={entry.date}>{formatDateTime(entry.date)}</time>
                  <span className="font-mono">{shortSha(entry.sha)}</span>
                  {index === 0 ? <span className="rounded-full bg-recessed px-1.5 py-px text-text-secondary">current</span> : null}
                  {entry.minor ? <span className="rounded-full bg-recessed px-1.5 py-px text-text-secondary">minor edit</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {failure === null ? null : (
        <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          Could not load older versions: {failure}
        </p>
      )}
      {older.next === null ? null : (
        <Button size="small" variant="ghost" className="self-start" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "Loading…" : "Load older versions"}
        </Button>
      )}
    </section>
  );
}
