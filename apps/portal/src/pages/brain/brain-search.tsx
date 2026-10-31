// Search results of the Brain, in place of the tree: an id, a node id or a path is looked up (brain_lookup);
// any other text is found as an exact string (brain_grep) and every line is shown in the node that holds it.

import type { BrainCrumb, BrainNode } from "@kintsugi/domain";
import { SearchX } from "lucide-react";
import { Loaded } from "@/components/loaded";
import { brainApi } from "@/lib/api/brain";
import { searchIntent } from "@/lib/brain";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { BrainNodeIcon } from "./brain-tree";

interface Result {
  node: BrainNode;
  breadcrumb: BrainCrumb[];
  lines: Array<{ line: number; excerpt: string }>;
}

interface Results {
  mode: "lookup" | "grep";
  items: Result[];
  truncated: boolean;
}

async function search(projectId: string, text: string): Promise<Results> {
  if (searchIntent(text) === "lookup") {
    const found = await brainApi.lookup(projectId, text);
    if (found.matches.length > 0) return { mode: "lookup", items: found.matches.map(({ breadcrumb, ...node }) => ({ node, breadcrumb, lines: [] })), truncated: false };
  }
  const found = await brainApi.grep(projectId, text);
  const byNode = new Map<string, Result>();
  for (const match of found.matches) {
    const known = byNode.get(match.node.id) ?? { node: match.node, breadcrumb: match.breadcrumb, lines: [] };
    known.lines.push({ line: match.line, excerpt: match.excerpt });
    byNode.set(match.node.id, known);
  }
  return { mode: "grep", items: [...byNode.values()], truncated: found.truncated };
}

/** The excerpt with each case-insensitive occurrence of the text marked. */
function Highlighted({ text, needle }: { text: string; needle: string }): React.JSX.Element {
  const lower = text.toLowerCase();
  const wanted = needle.trim().toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let index = lower.indexOf(wanted); wanted !== "" && index >= 0; index = lower.indexOf(wanted, index + wanted.length)) {
    parts.push(text.slice(at, index), <mark key={index} className="rounded-sm bg-hover px-0.5 text-text underline decoration-text-muted underline-offset-2">{text.slice(index, index + wanted.length)}</mark>);
    at = index + wanted.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export function BrainSearch({ projectId, version, text, selected, onSelect }: { projectId: string; version: string; text: string; selected: string; onSelect: (id: string) => void }): React.JSX.Element {
  const results = useLoader(`brain/${projectId}/${version}/search/${text}`, () => search(projectId, text));
  return (
    <Loaded loader={results} rows={6}>
      {(found) =>
        found.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <SearchX className="size-5 text-text-muted" strokeWidth={1.5} />
            <p className="text-[13px] text-text">Not in the Brain</p>
            <p className="text-[12px] text-text-muted">
              No indexed document contains “{text}”. An agent asking the same gets the same answer, and says so.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="px-1.5 text-[11px] uppercase tracking-wide text-text-muted">
              {found.mode === "lookup" ? "Named by" : "Contains"} “{text}” · {found.items.length} {found.items.length === 1 ? "node" : "nodes"}
              {found.truncated ? " · first matches only" : ""}
            </p>
            <ul className="flex flex-col gap-px" aria-label="Search results">
              {found.items.map((item) => (
                <li key={item.node.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 items-start gap-1.5 rounded-[var(--geist-radius)] px-1.5 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
                      item.node.id === selected ? "bg-hover" : undefined,
                    )}
                    onClick={() => onSelect(item.node.id)}
                  >
                    <BrainNodeIcon node={item.node} className="mt-0.5 text-text-muted" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] text-text">{item.node.title}</span>
                      <span className="truncate font-mono text-[11px] text-text-muted" title={item.node.path}>
                        {item.breadcrumb.slice(1).map((crumb) => crumb.title).join(" / ")}
                      </span>
                      {item.lines.map((line) => (
                        <span key={line.line} className="flex min-w-0 gap-2 text-[12px] text-text-secondary">
                          <span className="w-8 shrink-0 text-right font-mono text-[11px] text-text-muted tabular-nums">{line.line}</span>
                          <span className="min-w-0 break-words">
                            <Highlighted text={line.excerpt} needle={text} />
                          </span>
                        </span>
                      ))}
                      {found.mode === "lookup" && item.node.summary !== "" ? <span className="line-clamp-2 text-[12px] text-text-secondary">{item.node.summary}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </Loaded>
  );
}
