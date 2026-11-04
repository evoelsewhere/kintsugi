// The table of contents of a page: its headings in order, indented by level; a click goes to the heading. It is shown
// for a page with enough headings to need one (lib/wiki.ts `tocOf`) and folds away so it never pushes the text down.

import { ListTree } from "lucide-react";
import { Link } from "react-router-dom";
import { type TocEntry, wikiLink } from "@/lib/wiki";

export function WikiToc({ projectId, path, entries }: { projectId: string; path: string; entries: readonly TocEntry[] }): React.JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <details className="group rounded-lg bg-recessed px-3 py-2 text-[12px]" open>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-text-secondary select-none focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
        <ListTree className="size-3.5 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
        On this page
      </summary>
      <nav aria-label="Table of contents" className="mt-1.5">
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry, index) => (
            <li key={`${entry.anchor}:${index}`} style={{ paddingLeft: `${Math.min(entry.indent, 4) * 12}px` }}>
              <Link to={wikiLink(projectId, path, entry.anchor)} className="text-text-muted hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
