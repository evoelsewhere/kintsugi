// The archived pages of the wiki: the pages whose status is `archived`, which the tree, the search and the label pages leave
// out. Found by walking the Brain's tree (the document nodes carry their status); each opens, and can be unarchived by a
// person who may write it (the editor opens with the status line removed and the message ready).

import { Archive } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { EmptyState } from "@/components/ui/empty-state";
import { brainApi } from "@/lib/api/brain";
import { useLoader } from "@/lib/use-loader";
import { archivedPages, wikiLink, wikiPageLink, wikiRead } from "@/lib/wiki";

export function WikiArchived({ projectId, commit }: { projectId: string; commit: string }): React.JSX.Element {
  const found = useLoader(`wiki/${projectId}/${commit}/archived`, () => wikiRead(() => archivedPages(async (folder, offset) => brainApi.tree(projectId, folder, offset, 100))));
  return (
    <section aria-label="Archived pages" className="flex flex-col gap-3">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">Archived pages</h1>
      <Loaded loader={found} rows={3}>
        {(view) =>
          view.pages.length === 0 ? (
            <EmptyState icon={Archive} title="No archived pages" description="A page whose status is archived is listed here and left out of the tree and the search." />
          ) : (
            <>
              <p role="status" className="text-[12px] text-text-muted">
                {view.pages.length} {view.pages.length === 1 ? "page" : "pages"}
                {view.incomplete ? " · the wiki is too large to read all of it: this list may be incomplete" : ""}
              </p>
              <ul className="flex flex-col gap-1.5">
                {view.pages.map((page) => (
                  <li key={page.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--geist-radius)] p-3 shadow-border">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link to={wikiLink(projectId, page.path)} className="text-[14px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                        {page.title}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-text-muted">
                        {page.space === null ? null : <span className="font-mono">{page.space}</span>}
                        {page.breadcrumb.map((name, index) => (
                          <Fragment key={`${index}:${name}`}>
                            {index === 0 && page.space === null ? null : <span aria-hidden="true">/</span>}
                            <span>{name}</span>
                          </Fragment>
                        ))}
                      </p>
                    </div>
                    <Link to={wikiPageLink(projectId, page.path, { mode: "edit", change: "unarchive" })} className="text-[12px] text-accent hover:underline">
                      Unarchive
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </Loaded>
    </section>
  );
}
