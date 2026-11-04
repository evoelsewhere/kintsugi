// The recent changes of the wiki: the newest commits that changed pages, with who made them, when, the comment and the
// pages each one touched (a page opens in the reader). Fifty commits at a time; older ones load on request.

import { History } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { documentsApi, type RecentEntry } from "@/lib/api/documents";
import { errorText, formatDateTime, shortSha } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { CHANGE_LABEL, changedFileTarget, wikiLink, wikiPageLink, wikiRead } from "@/lib/wiki";

export interface WikiRecentProps {
  projectId: string;
  /** The commit the Brain indexed: the changes are those up to it. */
  commit: string;
}

export function WikiRecent({ projectId, commit }: WikiRecentProps): React.JSX.Element {
  const first = useLoader(`wiki/${projectId}/${commit}/recent`, () => wikiRead(() => documentsApi.recent(projectId, { ref: commit })));
  return (
    <section aria-label="Recent changes" className="flex flex-col gap-3">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">Recent changes</h1>
      <Loaded loader={first} rows={5}>
        {(view) =>
          view.entries.length === 0 ? (
            <EmptyState icon={History} title="No changes yet" description="No commit has changed a page of this wiki." />
          ) : (
            <Commits key={view.commit} projectId={projectId} commit={commit} first={view.entries} firstNext={view.next} />
          )
        }
      </Loaded>
    </section>
  );
}

function Commits({ projectId, commit, first, firstNext }: WikiRecentProps & { first: RecentEntry[]; firstNext: string | null }): React.JSX.Element {
  const [older, setOlder] = useState<{ entries: RecentEntry[]; next: string | null }>({ entries: [], next: firstNext });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loadOlder = async (): Promise<void> => {
    if (older.next === null) return;
    setLoading(true);
    setFailure(null);
    try {
      const page = await wikiRead(() => documentsApi.recent(projectId, { ref: commit, before: older.next ?? undefined }));
      setOlder((current) => ({ entries: [...current.entries, ...page.entries], next: page.next }));
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ol className="flex flex-col gap-2">
        {[...first, ...older.entries].map((entry) => (
          <li key={entry.sha} className="flex flex-col gap-1 rounded-[var(--geist-radius)] p-3 shadow-border">
            <p className="text-[13px] text-text">{entry.subject === "" ? "(no comment)" : entry.subject}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
              <span>{entry.actor}</span>
              <time dateTime={entry.date}>{formatDateTime(entry.date)}</time>
              <span className="font-mono">{shortSha(entry.sha)}</span>
              {entry.minor ? <span className="rounded-full bg-recessed px-1.5 py-px text-text-secondary">minor edit</span> : null}
            </p>
            <ul className="flex flex-col gap-0.5 text-[12px]">
              {entry.files.map((file) => {
                const target = changedFileTarget(file);
                return (
                  <li key={`${file.status}:${file.path}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-14 shrink-0 text-text-muted">{CHANGE_LABEL[file.status]}</span>
                    {target === undefined ? (
                      <span className="break-all text-text-secondary">{file.path}</span>
                    ) : (
                      <Link to={wikiLink(projectId, target)} className="break-all text-accent hover:underline">
                        {file.path}
                      </Link>
                    )}
                    {file.previousPath === null ? null : <span className="break-all text-text-muted">from {file.previousPath}</span>}
                    {target === undefined ? null : (
                      <Link to={wikiPageLink(projectId, target, { mode: "version", sha: entry.sha })} className="text-text-muted hover:text-text hover:underline">
                        this version
                      </Link>
                    )}
                  </li>
                );
              })}
              {entry.moreFiles ? <li className="text-text-muted">and more pages</li> : null}
            </ul>
          </li>
        ))}
      </ol>
      {failure === null ? null : (
        <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          Could not load older changes: {failure}
        </p>
      )}
      {older.next === null ? null : (
        <Button size="small" className="self-start" disabled={loading} onClick={() => void loadOlder()}>
          {loading ? "Loading…" : "Load older changes"}
        </Button>
      )}
    </>
  );
}
