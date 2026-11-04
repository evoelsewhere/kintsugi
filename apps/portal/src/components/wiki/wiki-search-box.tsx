// The search box of the wiki reader: a text and Enter. The space and the label that narrow a search stay as they are
// while the text changes; they are chosen on the results (wiki-search-results.tsx). Nothing is searched until Enter.

import { Search, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { type WikiSearch, wikiLink, wikiSearchLink } from "@/lib/wiki";

export function WikiSearchBox({ projectId, search }: { projectId: string; search: WikiSearch }): React.JSX.Element {
  const navigate = useNavigate();
  const [text, setText] = useState(search.q);
  // The address is the truth: the reader keys this box by the searched text, so a link to another search, back and
  // forward, show their text in it.

  return (
    <form
      role="search"
      aria-label="Search the wiki"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const q = text.trim();
        void navigate(q === "" ? wikiLink(projectId, "") : wikiSearchLink(projectId, { ...search, q }));
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
      <Input
        size="small"
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search the wiki"
        aria-label="Search the wiki"
        className="pr-8 pl-8"
        maxLength={200}
      />
      {search.q === "" ? null : (
        <button
          type="button"
          aria-label="Clear the search"
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          onClick={() => void navigate(wikiLink(projectId, ""))}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </form>
  );
}
