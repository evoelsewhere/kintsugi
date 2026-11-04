// The backlinks of a page: the pages that link to it, or to one of its headings, with the heading each link is under.
// The Brain answers in windows of twenty, in path order, with the total; "Show more" asks for the next window. A page
// nobody links to says so. Nothing is written; the list is a view of what the last build found.

import { Link2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { brainApi } from "@/lib/api/brain";
import { errorText } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { groupBacklinks, hiddenPaths, wikiLink, wikiRead } from "@/lib/wiki";
import { documentsOf } from "./hit-documents";

export interface WikiBacklinksProps {
  projectId: string;
  /** The commit the Brain indexed. */
  commit: string;
  /** The page's path: its node id in the Brain. */
  path: string;
}

export function WikiBacklinks({ projectId, commit, path }: WikiBacklinksProps): React.JSX.Element {
  const first = useLoader(`wiki/${projectId}/${commit}/backlinks/${path}`, () =>
    wikiRead(async () => {
      const view = await brainApi.backlinks(projectId, path);
      // The titles of the linking pages: a link is easier to pick by its page than by its file name.
      const documents = await documentsOf(projectId, commit, [...new Set(view.items.map((item) => item.node.path))]);
      return { view, titles: new Map([...documents].map(([page, document]) => [page, document.title] as const)), hidden: hiddenPaths(documents) };
    }),
  );
  return (
    <section aria-label="Backlinks" className="mt-6 flex flex-col gap-2 border-t border-[rgba(0,0,0,0.08)] pt-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-text">
        <Link2 className="size-3.5 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
        Backlinks{first.data === undefined ? "" : ` (${first.data.view.total})`}
      </h2>
      <Loaded loader={first} rows={2}>
        {({ view, titles, hidden }) =>
          view.total === 0 ? (
            <p className="text-[12px] text-text-muted">No other page links to this page.</p>
          ) : (
            <Windows key={view.commit} projectId={projectId} commit={commit} path={path} first={view} firstTitles={titles} firstHidden={hidden} />
          )
        }
      </Loaded>
    </section>
  );
}

function Windows({
  projectId,
  commit,
  path,
  first,
  firstTitles,
  firstHidden,
}: WikiBacklinksProps & { first: Awaited<ReturnType<typeof brainApi.backlinks>>; firstTitles: ReadonlyMap<string, string>; firstHidden: ReadonlySet<string> }): React.JSX.Element {
  const [more, setMore] = useState<{ items: typeof first.items; titles: ReadonlyMap<string, string>; hidden: ReadonlySet<string>; next: number | null }>({ items: [], titles: new Map(), hidden: new Set(), next: first.nextOffset });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pages = groupBacklinks([...first.items, ...more.items], new Map([...firstTitles, ...more.titles]), new Set([...firstHidden, ...more.hidden]));

  const showMore = async (): Promise<void> => {
    if (more.next === null) return;
    setLoading(true);
    setFailure(null);
    try {
      const view = await wikiRead(() => brainApi.backlinks(projectId, path, more.next ?? 0));
      const documents = await documentsOf(projectId, commit, [...new Set(view.items.map((item) => item.node.path))]);
      setMore((current) => ({
        items: [...current.items, ...view.items],
        titles: new Map([...current.titles, ...[...documents].map(([page, document]) => [page, document.title] as const)]),
        hidden: new Set([...current.hidden, ...hiddenPaths(documents)]),
        next: view.nextOffset,
      }));
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {pages.map((page) => (
          <li key={page.path} className="flex flex-col gap-0.5 text-[13px]">
            <Link to={wikiLink(projectId, page.path)} className="self-start text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
              {page.title}
            </Link>
            <ul className="flex flex-col pl-3 text-[12px] text-text-muted">
              {page.links.map((link, index) => (
                <li key={`${link.anchor ?? ""}:${index}`}>
                  <Link to={wikiLink(projectId, page.path, link.anchor ?? undefined)} className="hover:text-text hover:underline">
                    {link.section === null ? "In the page's opening text" : `In “${link.section}”`}
                  </Link>
                  {link.target === null ? null : <span> · links to “{link.target}”</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {failure === null ? null : (
        <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          Could not load more backlinks: {failure}
        </p>
      )}
      {more.next === null ? null : (
        <Button size="small" className="self-start" disabled={loading} onClick={() => void showMore()}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      )}
    </>
  );
}
