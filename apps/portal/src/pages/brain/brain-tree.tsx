// The Brain's tree (ADR-0091), loaded one level at a time as people open it — what an agent sees through
// brain_tree: every node with its summary, and no text. Arrow keys move between rows, Right opens, Left closes.

import type { BrainNode } from "@kintsugi/domain";
import { BRAIN_ROOT_ID } from "@kintsugi/domain";
import { Brain, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Hash, Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { brainApi } from "@/lib/api/brain";
import { formatTokens } from "@/lib/brain";
import { errorText } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE = 100;

interface Level {
  items: BrainNode[];
  total: number;
  loading: boolean;
  error?: string;
}

export function BrainNodeIcon({ node, open, className }: { node: Pick<BrainNode, "kind">; open?: boolean; className?: string }): React.JSX.Element {
  const props = { className: cn("size-4 shrink-0", className), strokeWidth: 1.5 };
  switch (node.kind) {
    case "root":
      return <Brain {...props} />;
    case "folder":
      return open === true ? <FolderOpen {...props} /> : <Folder {...props} />;
    case "document":
      return <FileText {...props} />;
    case "section":
      return <Hash {...props} />;
    case "card":
      return <Tag {...props} />;
  }
}

export interface BrainTreeProps {
  projectId: string;
  /** The root row: the repository at the indexed branch. */
  root: Pick<BrainNode, "id" | "kind" | "title">;
  selected: string;
  /** Nodes to open (the selected node's ancestors), so a deep link shows where it is. */
  reveal: readonly string[];
  showSummaries: boolean;
  onSelect: (id: string) => void;
}

export function BrainTree({ projectId, root, selected, reveal, showSummaries, onSelect }: BrainTreeProps): React.JSX.Element {
  const [levels, setLevels] = useState<ReadonlyMap<string, Level>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([BRAIN_ROOT_ID]));
  const requested = useRef(new Set<string>());
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (id: string, offset = 0): Promise<void> => {
      setLevels((current) => new Map(current).set(id, { items: current.get(id)?.items ?? [], total: current.get(id)?.total ?? 0, loading: true }));
      try {
        const page = await brainApi.tree(projectId, id, offset, PAGE);
        setLevels((current) => {
          const previous = offset === 0 ? [] : (current.get(id)?.items ?? []);
          return new Map(current).set(id, { items: [...previous, ...page.children], total: page.total, loading: false });
        });
      } catch (failure) {
        requested.current.delete(id);
        setLevels((current) => new Map(current).set(id, { items: current.get(id)?.items ?? [], total: current.get(id)?.total ?? 0, loading: false, error: errorText(failure) }));
      }
    },
    [projectId],
  );

  const ensure = useCallback(
    (id: string) => {
      if (requested.current.has(id)) return;
      requested.current.add(id);
      void load(id);
    },
    [load],
  );

  useEffect(() => ensure(BRAIN_ROOT_ID), [ensure]);
  useEffect(() => {
    if (reveal.length === 0) return;
    setOpen((current) => {
      const next = new Set(current);
      for (const id of reveal) next.add(id);
      return next;
    });
    for (const id of reveal) ensure(id);
  }, [reveal, ensure]);

  // Keeps the selected row in view when it changes from elsewhere (a link, a search result).
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, levels]);

  const toggle = (node: BrainNode): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(node.id)) {
        next.add(node.id);
        ensure(node.id);
      }
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>("button[role=treeitem]") ?? [])];
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    const row = rows[index];
    const id = row?.dataset["nodeId"];
    const expandable = row?.dataset["expandable"] === "true";
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (event.key === "ArrowRight" && id !== undefined && expandable && !open.has(id)) {
      event.preventDefault();
      setOpen((current) => new Set(current).add(id));
      ensure(id);
    } else if (event.key === "ArrowLeft" && id !== undefined && open.has(id)) {
      event.preventDefault();
      setOpen((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
    }
  };

  const renderLevel = (parentId: string, depth: number): React.ReactNode => {
    const level = levels.get(parentId);
    if (level === undefined || (level.loading && level.items.length === 0)) {
      return (
        <li role="none" className="py-1 text-[12px] text-text-muted" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          Loading…
        </li>
      );
    }
    return (
      <>
        {level.items.map((node) => {
          const expandable = node.children > 0;
          const isOpen = open.has(node.id);
          const active = node.id === selected;
          return (
            <li key={node.id} role="none">
              <div className="group flex items-start" style={{ paddingLeft: 4 + depth * 14 }}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className={cn("mt-[5px] flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text", !expandable && "invisible")}
                  onClick={() => toggle(node)}
                >
                  {isOpen ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
                </button>
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={active}
                  aria-expanded={expandable ? isOpen : undefined}
                  data-node-id={node.id}
                  data-expandable={expandable}
                  title={node.summary === "" ? node.title : `${node.title}\n\n${node.summary}`}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-1.5 rounded-[var(--geist-radius)] px-1.5 py-1 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
                    active ? "bg-hover text-text" : "text-text-secondary",
                  )}
                  onClick={() => onSelect(node.id)}
                  onDoubleClick={() => expandable && toggle(node)}
                >
                  <BrainNodeIcon node={node} open={isOpen} className="mt-px text-text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px]">{node.title}</span>
                      {node.kind === "folder" || node.kind === "root" ? (
                        <span className="shrink-0 text-[11px] text-text-muted tabular-nums">{node.children}</span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-text-muted tabular-nums opacity-0 group-hover:opacity-100">{formatTokens(node.subtreeTokens)}</span>
                      )}
                    </span>
                    {showSummaries && node.summary !== "" ? <span className="truncate text-[11px] leading-4 text-text-muted">{node.summary}</span> : null}
                  </span>
                </button>
              </div>
              {expandable && isOpen ? <ul role="group">{renderLevel(node.id, depth + 1)}</ul> : null}
            </li>
          );
        })}
        {level.error === undefined ? null : (
          <li role="none" className="py-1 text-[12px] text-[var(--ds-status-red)]" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
            {level.error}{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => void load(parentId, level.items.length)}>
              Retry
            </button>
          </li>
        )}
        {level.items.length < level.total ? (
          <li role="none" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
            <button type="button" disabled={level.loading} className="py-1 text-[12px] text-accent hover:underline disabled:text-text-muted" onClick={() => void load(parentId, level.items.length)}>
              {level.loading ? "Loading…" : `Show ${Math.min(PAGE, level.total - level.items.length)} more of ${level.total - level.items.length}`}
            </button>
          </li>
        ) : null}
      </>
    );
  };

  return (
    <ul ref={list} role="tree" aria-label="Brain tree" className="flex flex-col gap-px" onKeyDown={onKeyDown}>
      <li role="none">
        <button
          type="button"
          role="treeitem"
          aria-selected={selected === root.id}
          aria-expanded
          data-node-id={root.id}
          data-expandable="false"
          className={cn(
            "flex w-full items-center gap-1.5 rounded-[var(--geist-radius)] px-1.5 py-1 text-left text-[13px] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
            selected === root.id ? "bg-hover text-text" : "text-text-secondary",
          )}
          onClick={() => onSelect(root.id)}
        >
          <BrainNodeIcon node={root} className="text-text-muted" />
          <span className="truncate">{root.title}</span>
        </button>
        <ul role="group">{renderLevel(root.id, 0)}</ul>
      </li>
    </ul>
  );
}
