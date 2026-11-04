// The page of a label: every page that carries it, by title, with the folders it is in, its space and its status.
// The Brain answers `label:<name>` with the pages that have it (ADR-0097 decision 8), the same answer an agent gets.

import { Tag } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { EmptyState } from "@/components/ui/empty-state";
import { brainApi } from "@/lib/api/brain";
import { useLoader } from "@/lib/use-loader";
import { pagesWithLabel, wikiLabelLink, wikiLink, wikiRead } from "@/lib/wiki";

export interface WikiLabelPageProps {
  projectId: string;
  /** The commit the Brain indexed: the label's pages of another build are not the same pages. */
  commit: string;
  label: string;
}

export function WikiLabelPage({ projectId, commit, label }: WikiLabelPageProps): React.JSX.Element {
  // The lookup stops at twenty pages: the page walks the Brain's tree instead and keeps every page with the label.
  const found = useLoader(`wiki/${projectId}/${commit}/label/${label}`, () =>
    wikiRead(() => pagesWithLabel(async (folder, offset) => brainApi.tree(projectId, folder, offset, 100), label)),
  );
  return (
    <section aria-label={`Pages with the label ${label}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link to={wikiLink(projectId, "")} className="self-start text-[12px] text-text-muted hover:text-text hover:underline">
          Wiki
        </Link>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight text-text">
          <Tag className="size-4 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
          {label}
        </h1>
      </div>
      <Loaded loader={found} rows={4}>
        {(view) => {
          const pages = view.pages;
          return pages.length === 0 ? (
            <EmptyState icon={Tag} title="No page has this label" description={`No page of the wiki carries the label “${label}”.`} />
          ) : (
            <>
              <p role="status" className="text-[12px] text-text-muted">
                {pages.length} {pages.length === 1 ? "page" : "pages"}
                {view.incomplete ? " · the wiki is too large to read all of it: this list may be incomplete" : ""}
              </p>
              <ul className="flex flex-col gap-1.5">
                {pages.map((page) => (
                  <li key={page.path} className="flex flex-col gap-1 rounded-[var(--geist-radius)] p-3 shadow-border">
                    <Link to={wikiLink(projectId, page.path)} className="text-[14px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                      {page.title}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-text-muted">
                      {page.space === null ? null : <span className="font-mono">{page.space}</span>}
                      {page.breadcrumb.map((name, index) => (
                        <Fragment key={`${index}:${name}`}>
                          {index === 0 && page.space === null ? null : <span aria-hidden="true">/</span>}
                          <span>{name}</span>
                        </Fragment>
                      ))}
                      {page.status === null ? null : <span className="rounded-full bg-recessed px-1.5 py-px text-text-secondary">{page.status}</span>}
                      {page.labels
                        .filter((other) => other !== label)
                        .map((other) => (
                          <Link key={other} to={wikiLabelLink(projectId, other)} className="flex items-center gap-1 rounded-full bg-recessed px-1.5 py-px text-text-secondary hover:text-text">
                            <Tag className="size-2.5" strokeWidth={1.75} aria-hidden="true" />
                            {other}
                          </Link>
                        ))}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Loaded>
    </section>
  );
}
