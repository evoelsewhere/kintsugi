// What a search of the wiki found: the pages best first (the Brain's ranked search), each with its summary and the line
// that matched, the words marked, and the heading it is under; an API without the ranked search gives the pages that
// contain the exact text, as before; a click opens the page scrolled to that heading. The space and the label narrow the
// search on the server (before its limit cuts the list), and the choices they offer are the spaces and labels of the
// pages the text is in. Excerpts are shown as text, never as HTML.

import type { BrainNode } from "@kintsugi/domain";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Select } from "@/components/ui/select";
import { brainApi } from "@/lib/api/brain";
import { searchProblem } from "@/lib/brain";
import { leftOutNote, outcomeHits, runSearch, SEARCH_LIMIT } from "@/lib/brain-search";
import { useLoader } from "@/lib/use-loader";
import { hitCount, hitPaths, rankedCount, searchFacets, type WikiSearch, wikiRead, wikiSearchLink, withDocuments } from "@/lib/wiki";
import { documentsOf } from "./hit-documents";
import { SearchHitCard } from "./search-hit-card";

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
  // Archived pages and templates are left out of a ranked search unless the person asks for them; the choice is the
  // person's for this list only (nothing is stored in the browser).
  const [archived, setArchived] = useState(false);
  const base = `wiki/${projectId}/${commit}/search/${search.q}`;
  // The ranked search; an API without the route, or a Brain that is not built, is answered by the exact text search.
  const ask = (filter: { space?: string; label?: string }) =>
    wikiRead(() =>
      runSearch({
        search: () => brainApi.search(projectId, search.q, { ...filter, archived, limit: SEARCH_LIMIT }),
        grep: () => brainApi.grep(projectId, search.q, undefined, filter),
      }),
    );
  // The text alone gives the spaces and labels to choose from; a search with a filter is a request of its own.
  const everything = useLoader(`${base}/${archived}`, () => ask({}));
  const filtered = useLoader(`${base}/${search.space}/${search.label}/${archived}`, () => (narrowed ? ask({ space: search.space, label: search.label }) : Promise.resolve(null)));
  const shown = narrowed ? filtered : everything;
  // The pages of both lists: their document nodes hold the space and the labels the results and the filters show.
  const include = { includeHidden: archived };
  const everyHit = outcomeHits(everything.data, include);
  const shownHit = outcomeHits(shown.data, include);
  const paths = hitPaths([...shownHit, ...everyHit]);
  const documents = useLoader(`${base}/documents/${paths.join("|")}`, () => documentsOf(projectId, commit, paths));
  const known = documents.data ?? new Map<string, BrainNode>();
  const facets = searchFacets(withDocuments(everyHit, known, include));
  return (
    <>
      <Filters projectId={projectId} search={search} spaces={facets.spaces} labels={facets.labels} />
      <Loaded loader={shown} rows={5}>
        {(outcome) => {
          const hits = withDocuments(outcomeHits(outcome, include), known, include);
          const ranked = outcome?.kind === "ranked";
          const note = outcome?.kind === "ranked" ? leftOutNote(outcome.view.leftOut) : "";
          const leftOut = note === "" ? null : (
            <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted" role="status">
              {note}
              <button type="button" className="text-accent hover:underline" onClick={() => setArchived(true)}>
                Include them
              </button>
            </p>
          );
          return hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <SearchX className="size-5 text-text-muted" strokeWidth={1.5} />
              <p className="text-[13px] text-text">No page found</p>
              <p className="max-w-md text-[12px] text-text-muted">
                No page of the wiki {ranked ? "matches" : "contains"} “{search.q}”{search.space === "" ? "" : ` in the space ${search.space}`}
                {search.label === "" ? "" : ` with the label ${search.label}`}.
                {ranked ? " The search looks for the words, best match first." : " The search finds the exact text, not similar words."}
              </p>
              {leftOut}
            </div>
          ) : (
            <>
              <p className="text-[12px] text-text-muted" role="status">
                {ranked ? rankedCount(hits.length, search.q) : hitCount(hits.length, search.q)}
                {outcome?.kind === "exact" && outcome.view.truncated ? " · there are more results, narrow the search (a space, a label or more of the text)" : ""}
              </p>
              {leftOut}
              {archived ? (
                <p className="text-[12px] text-text-muted">
                  Archived pages and templates are included.{" "}
                  <button type="button" className="text-accent hover:underline" onClick={() => setArchived(false)}>
                    Leave them out
                  </button>
                </p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {hits.map((hit) => (
                  <SearchHitCard key={hit.path} projectId={projectId} hit={hit} query={search.q} ranked={ranked} />
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
