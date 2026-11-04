// The comment box with @mention suggestions: typing `@` and the start of a name offers the people of the project (from the
// directory, display name and username, no email); arrow keys and Enter, or a click, put `@username` into the text. The
// suggestions are only a help: a comment with a name that is not a person of the project simply mentions nobody.

import { useEffect, useId, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { wikiPeopleApi } from "@/lib/api/wiki-people";
import { cn } from "@/lib/utils";
import { insertMention, type MentionQuery, mentionQueryAt, type Person } from "@/lib/wiki-mentions";

const SUGGEST_DELAY_MS = 150;

export interface MentionTextareaProps {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
}

export function MentionTextarea({ projectId, value, onChange, placeholder, label, className, autoFocus }: MentionTextareaProps): React.JSX.Element {
  const wrapper = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState<(MentionQuery & { cursor: number }) | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState(0);

  const typed = query?.query;
  useEffect(() => {
    if (typed === undefined) return;
    let current = true;
    const timer = setTimeout(() => {
      wikiPeopleApi.search(projectId, typed).then(
        (found) => {
          if (!current) return;
          setPeople(found.slice(0, 8));
          setActive(0);
        },
        // The directory could not be read: no suggestions, the text is still sent as typed.
        () => current && setPeople([]),
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [projectId, typed]);

  const look = (next: string, cursor: number): void => {
    const found = mentionQueryAt(next, cursor);
    setQuery(found === null ? null : { ...found, cursor });
    if (found === null) setPeople([]);
  };

  const choose = (person: Person): void => {
    if (query === null) return;
    const done = insertMention(value, query, query.cursor, person.username);
    onChange(done.text);
    setQuery(null);
    setPeople([]);
    // The cursor goes after the name once the text has been put back in the box.
    requestAnimationFrame(() => {
      const area = wrapper.current?.querySelector("textarea");
      area?.focus();
      area?.setSelectionRange(done.cursor, done.cursor);
    });
  };

  const open = query !== null && people.length > 0;
  return (
    <div ref={wrapper} className="relative">
      <Textarea
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={className}
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
          look(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => {
          // A move of the cursor by the arrows (not those that choose a suggestion) can leave the mention.
          if (!open || (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter" && event.key !== "Escape")) look(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onClick={(event) => look(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % people.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + people.length) % people.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const person = people[active];
            if (person !== undefined) choose(person);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setQuery(null);
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label="People" className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg bg-surface p-1 shadow-border-medium">
          {people.map((person, index) => (
            <li key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                tabIndex={-1}
                className={cn("flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-hover", index === active && "bg-hover")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
              >
                <span className="text-text">{person.displayName === "" ? person.username : person.displayName}</span>
                <span className="font-mono text-[11px] text-text-muted">@{person.username}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
