// File browser — the file tree beside a code view, like an editor's project view. The caller owns the
// contents (loaded up front or per file) and passes the selected file's text. A Markdown file can be
// shown rendered (Preview) or as the source (Raw); the choice stays while another file is opened.

import { useState } from "react";
import { FileTree } from "@/components/file-tree";
import { Markdown } from "@/components/results/lazy-markdown";
import { CodeView } from "@/components/code/code-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A Markdown file's frontmatter (the lines between the leading `---` fences) and its body. */
function splitFrontmatter(text: string): { front: string; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { front: "", body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { front: "", body: text };
  return { front: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

type View = "preview" | "raw";

function ViewToggle({ value, onChange }: { value: View; onChange: (view: View) => void }): React.JSX.Element {
  return (
    <span role="radiogroup" aria-label="Markdown view" className="inline-flex overflow-hidden rounded-md shadow-border font-sans">
      {(["preview", "raw"] as const).map((view) => (
        <button
          key={view}
          type="button"
          role="radio"
          aria-checked={value === view}
          onClick={() => onChange(view)}
          className={cn("px-2 py-0.5 text-[11px] capitalize hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]", value === view ? "bg-hover text-text" : "text-text-secondary")}
        >
          {view}
        </button>
      ))}
    </span>
  );
}

/** A Markdown file rendered: the frontmatter as a small table, then the body. */
function MarkdownPreview({ text }: { text: string }): React.JSX.Element {
  const { front, body } = splitFrontmatter(text);
  const rows = front
    .split("\n")
    .map((line) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line))
    .flatMap((match) => (match === null || match[2] === "" ? [] : [[match[1]!, match[2]!] as const]));
  return (
    <div className="h-full overflow-auto p-4 text-[13px] text-text">
      {rows.length === 0 ? null : (
        <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-recessed p-3 text-[12px]">
          {rows.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-text-muted">{key}</dt>
              <dd className="min-w-0 break-words text-text-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Markdown text={body} />
    </div>
  );
}

export interface FileBrowserProps {
  /** Heading of the tree. */
  title: string;
  paths: readonly string[];
  selected: string;
  onSelect: (path: string) => void;
  /** The selected file's text; undefined while it loads. */
  text: string | undefined;
  error?: string | null;
  className?: string;
  /** Editing: the selected file's text changes through this; omit for a read-only view. */
  onChange?: (text: string) => void;
  /** Extra controls above the tree (new file) and in the file bar (delete). */
  treeActions?: React.ReactNode;
  fileActions?: React.ReactNode;
}

export function FileBrowser({ title, paths, selected, onSelect, text, error = null, className, onChange, treeActions, fileActions }: FileBrowserProps): React.JSX.Element {
  const [view, setView] = useState<View>("preview");
  const markdown = selected.toLowerCase().endsWith(".md");
  return (
    <div className={cn("flex h-[calc(100vh-17rem)] min-h-96 overflow-hidden rounded-[var(--geist-radius)] shadow-border", className)}>
      <nav aria-label={`${title} files`} className="w-64 shrink-0 overflow-auto p-2 [box-shadow:1px_0_0_rgba(0,0,0,0.08)]">
        <p className="truncate px-2 pb-1.5 text-[11px] tracking-wide text-text-muted uppercase">{title}</p>
        {treeActions}
        <FileTree paths={paths} selected={selected} onSelect={onSelect} />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[12px] text-text-secondary [box-shadow:0_1px_0_rgba(0,0,0,0.08)]">
          <span className="truncate">{selected}</span>
          <span className="flex shrink-0 items-center gap-3 text-text-muted">
            {fileActions}
            {markdown ? <ViewToggle value={view} onChange={setView} /> : null}
            {text === undefined ? null : <span>{text.split("\n").length} lines</span>}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {error !== null ? (
            <p role="alert" className="p-3 text-[13px] text-[var(--ds-status-red)]">
              {error}
            </p>
          ) : text === undefined ? (
            <div className="p-3">
              <SkeletonRows rows={8} />
            </div>
          ) : markdown && view === "preview" ? (
            <MarkdownPreview text={text} />
          ) : (
            <CodeView text={text} path={selected} onChange={onChange} />
          )}
        </div>
      </div>
    </div>
  );
}
