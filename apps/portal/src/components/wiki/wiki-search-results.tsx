// What a search of the wiki found: the pages that contain the text, each with the lines that do, the text marked, and
// the heading each line is under; a click opens the page scrolled to that heading. The space and the label narrow the
// search on the server (before its limit cuts the list), and the choices they offer are the spaces and labels of the
// pages the text is in. Excerpts are shown as text, never as HTML.

import type { BrainNode } from "@kintsugi/domain";
import { SearchX, Tag } from "lucide-react";
import { Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Select } from "@/components/ui/select";
import { brainApi } from "@/lib/api/brain";
import { searchProblem } from "@/lib/brain";
import { useLoader } from "@/lib/use-loader";
import { highlightParts, hitCount, hitPaths, searchFacets, searchHits, searchLineLink, type WikiSearch, wikiLink, wikiRead, wikiSearchLink, wikiSpaceLink, withDocuments } from "@/lib/wiki";
import { documentsOf } from "./hit-documents";

export interface WikiSearchResultsProps {
  projectId: string;
  /** The commit the Brain indexed: results of another build are not the same results. */
  commit: string;
  search: WikiSearch;
}

export function WikiSearchResults({ projectId, commit, search }: WikiSearchResultsProps): React.JSX.Element {
  const problem = searchProblem(search.q);
  return (
    <section aria-label="Search results" className="flex flex-col gap-3">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">Search</h1>
      {problem === undefined ? (
        <Results projectId={projectId} commit={commit} search={search} />
      ) : (
        <p role="status" className="py-8 text-center text-[13px] text-text-muted">
          {problem}
        </p>
      )}
    </section>
  );
}

function Results({ projectId, commit, search }: WikiSearchResultsProps): React.JSX.Element {
  const narrowed = search.space !== "" || search.label !== "";
  const base = `wiki/${projectId}/${commit}/search/${search.q}`;
  // The text alone gives the spaces and labels to choose from; a search with a filter is a request of its own.
  const everything = useLoader(base, () => wikiRead(() => brainApi.grep(projectId, search.q)));
  const filtered = useLoader(`${base}/${search.space}/${search.label}`, () =>
    narrowed ? wikiRead(() => brainApi.grep(projectId, search.q, undefined, { space: search.space, label: search.label })) : Promise.resolve(null),
  );
  const shown = narrowed ? filtered : everything;
  // The pages of both lists: their document nodes hold the space and the labels the results and the filters show.
  const everyHit = searchHits(everything.data?.matches ?? []);
  const shownHit = searchHits(shown.data?.matches ?? []);
  const paths = hitPaths([...shownHit, ...everyHit]);
  const documents = useLoader(`${base}/documents/${paths.join("|")}`, () => documentsOf(projectId, commit, paths));
  const known = documents.data ?? new Map<string, BrainNode>();
  const facets = searchFacets(withDocuments(everyHit, known));
  return (
    <>
      <Filters projectId={projectId} search={search} spaces={facets.spaces} labels={facets.labels} />
      <Loaded loader={shown} rows={5}>
        {(view) => {
          const hits = withDocuments(searchHits(view?.matches ?? []), known);
          return hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <SearchX className="size-5 text-text-muted" strokeWidth={1.5} />
              <p className="text-[13px] text-text">No page found</p>
              <p className="max-w-md text-[12px] text-text-muted">
                No page of the wiki contains “{search.q}”{search.space === "" ? "" : ` in the space ${search.space}`}
                {search.label === "" ? "" : ` with the label ${search.label}`}. The search finds the exact text, not similar words.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-text-muted" role="status">
                {hitCount(hits.length, search.q)}
                {view?.truncated === true ? " · there are more results, narrow the search (a space, a label or more of the text)" : ""}
              </p>
              <ul className="flex flex-col gap-2">
                {hits.map((hit) => (
                  <li key={hit.path} className="flex flex-col gap-1.5 rounded-[var(--geist-radius)] p-3 shadow-border">
                    <Link to={wikiLink(projectId, hit.path)} className="text-[14px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                      {hit.title}
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
                    <ul className="flex flex-col gap-px">
                      {hit.lines.map((line) => (
                        <li key={line.line}>
                          <Link
                            to={searchLineLink(projectId, hit, line)}
                            className="flex min-w-0 items-baseline gap-2 rounded-sm px-1 py-0.5 text-[12px] text-text-secondary hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                          >
                            <span className="w-8 shrink-0 text-right font-mono text-[11px] text-text-muted tabular-nums">{line.line}</span>
                            <span className="min-w-0 break-words">
                              {line.section === null ? null : <span className="mr-1.5 text-text-muted">{line.section} ·</span>}
                              {highlightParts(line.excerpt, search.q).map((part, index) =>
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
                ))}
              </ul>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

/** The space and the label of a search: any of the pages' own, or none. A choice is a new address, so it can be shared. */
function Filters({ projectId, search, spaces, labels }: { projectId: string; search: WikiSearch; spaces: string[]; labels: string[] }): React.JSX.Element | null {
  const navigate = useNavigate();
  // What the address already asks stays in the list, also when the text alone offers other choices.
  const spaceChoices = spaces.includes(search.space) || search.space === "" ? spaces : [search.space, ...spaces];
  const labelChoices = labels.includes(search.label) || search.label === "" ? labels : [search.label, ...labels];
  if (spaceChoices.length === 0 && labelChoices.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Narrow the search">
      <Select
        size="small"
        className="w-44"
        value={search.space}
        placeholder="Any space"
        options={[{ value: "", label: "Any space" }, ...spaceChoices.map((space) => ({ value: space, label: space }))]}
        onChange={(space) => void navigate(wikiSearchLink(projectId, { ...search, space }))}
      />
      <Select
        size="small"
        className="w-44"
        value={search.label}
        placeholder="Any label"
        options={[{ value: "", label: "Any label" }, ...labelChoices.map((label) => ({ value: label, label }))]}
        onChange={(label) => void navigate(wikiSearchLink(projectId, { ...search, label }))}
      />
    </div>
  );
}
