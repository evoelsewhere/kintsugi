// One page of a search result: its title, where it is, its labels, (for a ranked hit) the Brain's summary, and the lines
// that matched, the matching words marked. Every text is shown as text, never as HTML. A line links to the page at the
// heading it is under.

import { Tag } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { highlightWords } from "@/lib/brain-search";
import { highlightParts, type SearchHit, searchLineLink, wikiLink, wikiSpaceLink } from "@/lib/wiki";

export interface SearchHitCardProps {
  projectId: string;
  hit: SearchHit;
  query: string;
  /** A ranked hit marks each word of the query; an exact one marks the whole text. */
  ranked: boolean;
}

export function SearchHitCard({ projectId, hit, query, ranked }: SearchHitCardProps): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--geist-radius)] p-3 shadow-border">
      <Link to={wikiLink(projectId, hit.path)} className="text-[14px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
        {hit.title}
        {hit.hidden === undefined ? null : <span className="ml-2 rounded-full bg-recessed px-1.5 py-px text-[11px] font-normal text-text-secondary">{hit.hidden}</span>}
      </Link>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-text-muted">
        {hit.space === null ? null : (
          <Link to={wikiSpaceLink(projectId, hit.space)} title={`The home page of the space ${hit.space}`} className="font-mono hover:text-text hover:underline">
            {hit.space}
          </Link>
        )}
        {hit.breadcrumb.map((name, index) => (
          <Fragment key={`${index}:${name}`}>
            {index === 0 && hit.space === null ? null : <span aria-hidden="true">/</span>}
            <span>{name}</span>
          </Fragment>
        ))}
        {hit.labels.map((label) => (
          <span key={label} className="ml-1 flex items-center gap-1 rounded-full bg-recessed px-1.5 py-px text-text-secondary">
            <Tag className="size-2.5" strokeWidth={1.75} aria-hidden="true" />
            {label}
          </span>
        ))}
      </p>
      {hit.summary === undefined || hit.summary === "" ? null : <p className="text-[12px] text-text-secondary">{hit.summary}</p>}
      <ul className="flex flex-col gap-px">
        {hit.lines.map((line) => (
          <li key={`${line.line}:${line.anchor ?? ""}`}>
            <Link
              to={searchLineLink(projectId, hit, line)}
              className="flex min-w-0 items-baseline gap-2 rounded-sm px-1 py-0.5 text-[12px] text-text-secondary hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
            >
              <span className="w-8 shrink-0 text-right font-mono text-[11px] text-text-muted tabular-nums">{line.line}</span>
              <span className="min-w-0 break-words">
                {line.section === null ? null : <span className="mr-1.5 text-text-muted">{line.section} ·</span>}
                {(ranked ? highlightWords(line.excerpt, query) : highlightParts(line.excerpt, query)).map((part, index) =>
                  part.match ? (
                    <mark key={index} className="rounded-sm bg-hover px-0.5 text-text underline decoration-text-muted underline-offset-2">
                      {part.text}
                    </mark>
                  ) : (
                    <Fragment key={index}>{part.text}</Fragment>
                  ),
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
