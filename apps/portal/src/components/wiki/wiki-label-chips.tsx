// The labels of the page being edited, as chips: add one by typing it, remove one with its button. Only the `labels:` entry
// of the front matter changes (lib/wiki-edit.ts `setLabels`); the rest of the text is kept byte for byte. A label is added
// only in the form the Brain stores (lower case, letters, digits and hyphens), so what is shown is what the page will have.

import { Tag, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labelCheck, labelsOf, setLabels } from "@/lib/wiki-edit";

export function LabelChips({ text, onChange }: { text: string; onChange: (text: string) => void }): React.JSX.Element {
  const labels = labelsOf(text);
  const [input, setInput] = useState("");
  const check = labelCheck(input, labels);
  const add = (): void => {
    if (check.cleaned === "" || check.problem !== undefined) return;
    onChange(setLabels(text, [...labels, check.cleaned]));
    setInput("");
  };
  return (
    <div className="flex flex-col gap-1.5" aria-label="Labels of the page" role="group">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag className="size-3.5 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
        {labels.length === 0 ? <span className="text-[12px] text-text-muted">No labels</span> : null}
        {labels.map((label) => (
          <span key={label} className="flex items-center gap-1 rounded-full bg-recessed py-0.5 pr-1 pl-2 text-[12px] text-text-secondary">
            {label}
            <button
              type="button"
              aria-label={`Remove the label ${label}`}
              className="grid size-4 place-items-center rounded-full text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              onClick={() => onChange(setLabels(text, labels.filter((other) => other !== label)))}
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <Input
          size="small"
          value={input}
          placeholder="Add a label"
          aria-label="Add a label"
          aria-invalid={check.problem !== undefined}
          className="w-36"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button size="small" disabled={check.cleaned === "" || check.problem !== undefined} onClick={add}>
          Add
        </Button>
      </div>
      {check.problem === undefined ? null : <p className="text-[12px] text-[var(--ds-status-red)]">{check.problem}</p>}
    </div>
  );
}
