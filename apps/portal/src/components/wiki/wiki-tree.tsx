// The wiki's page tree: the folders and pages of the document repository, one level loaded at a time as people open
// a folder, with the title of each page and the Brain's order (the manual `order` of a home page). Archived pages and
// templates are left out. Arrow keys move between the rows, Right opens a folder, Left closes it.

import type { BrainNode } from "@kintsugi/domain";
import { BRAIN_ROOT_ID } from "@kintsugi/domain";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { brainApi } from "@/lib/api/brain";
import { errorText } from "@/lib/format";
import { foldersAbove, nameOf, type TreeLevel, treeRows, wikiLink } from "@/lib/wiki";
import { cn } from "@/lib/utils";

const PAGE = 100;

/** What a row is called: a page by its title, a folder by its name (its home page, listed first inside it, carries the title). */
const rowTitle = (node: BrainNode): string => (node.kind === "folder" ? nameOf(node.path) : node.title);

export interface WikiTreeProps {
  projectId: string;
  /** The page or folder shown, as a repository path ("" for the root). */
  selectedPath: string;
}

export function WikiTree({ projectId, selectedPath }: WikiTreeProps): React.JSX.Element {
  const [levels, setLevels] = useState<ReadonlyMap<string, TreeLevel>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([BRAIN_ROOT_ID]));
  const requested = useRef(new Set<string>());
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (id: string, offset = 0): Promise<void> => {
      setLevels((current) => new Map(current).set(id, { items: current.get(id)?.items ?? [], total: current.get(id)?.total ?? 0, loading: true }));
      try {
        const page = await brainApi.tree(projectId, id, offset, PAGE);
        setLevels((current) => new Map(current).set(id, { items: [...(offset === 0 ? [] : (current.get(id)?.items ?? [])), ...page.children], total: page.total, loading: false }));
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

  // A page opened from a link or a reload shows where it is: the folders above it open.
  useEffect(() => {
    const above = foldersAbove(selectedPath);
    setOpen((current) => new Set([...current, ...above]));
    for (const id of above) ensure(id);
  }, [selectedPath, ensure]);

  const rows = useMemo(() => treeRows(BRAIN_ROOT_ID, levels, open), [levels, open]);
  const selectedId = rows.find((row) => row.node.path === selectedPath)?.node.id;

  useEffect(() => {
    if (selectedId === undefined) return;
    list.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, rows.length]);

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

  // One Tab stop for the whole tree (roving tabindex): the row last focused, else the selected one, else the first.
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const tabStop = rows.find((row) => row.node.id === focused)?.node.id ?? selectedId ?? rows[0]?.node.id;

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const items = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[role=treeitem]") ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    if (index < 0) return;
    const id = items[index]?.dataset["nodeId"];
    const row = rows.find((candidate) => candidate.node.id === id);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (event.key === "ArrowRight" && row?.expandable === true && !row.open) {
      event.preventDefault();
      toggle(row.node);
    } else if (event.key === "ArrowLeft" && row?.open === true) {
      event.preventDefault();
      toggle(row.node);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  const renderMore = (parentId: string, depth: number): React.ReactNode => {
    const level = levels.get(parentId);
    if (level === undefined || level.loading) {
      return (
        <li role="none" className="py-1 text-[12px] text-text-muted" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          Loading…
        </li>
      );
    }
    if (level.error !== undefined) {
      return (
        <li role="none" className="flex flex-wrap items-center gap-2 py-1 text-[12px] text-[var(--ds-status-red)]" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          <span className="min-w-0 break-words">{level.error}</span>
          <button type="button" className="text-accent hover:underline" onClick={() => void load(parentId, level.items.length)}>
            Retry
          </button>
        </li>
      );
    }
    if (level.items.length < level.total) {
      return (
        <li role="none" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          <button type="button" className="py-1 text-[12px] text-accent hover:underline" onClick={() => void load(parentId, level.items.length)}>
            Show more
          </button>
        </li>
      );
    }
    return null;
  };

  // Rows come flat in reading order; what follows each open folder's rows (loading, error, "show more") is placed after them.
  const content: React.ReactNode[] = [];
  const closing: Array<{ parentId: string; depth: number }> = [{ parentId: BRAIN_ROOT_ID, depth: 0 }];
  const flush = (depth: number): void => {
    while ((closing[closing.length - 1]?.depth ?? -1) > depth) {
      const done = closing.pop();
      if (done !== undefined) content.push(<Fragment key={`more-${done.parentId}`}>{renderMore(done.parentId, done.depth)}</Fragment>);
    }
  };
  for (const row of rows) {
    flush(row.depth);
    const { node } = row;
    const active = node.path === selectedPath;
    content.push(
      <li key={node.id} role="none">
        <div className="flex items-start" style={{ paddingLeft: 4 + row.depth * 14 }}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={cn("mt-[5px] flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text", !row.expandable && "invisible")}
            onClick={() => toggle(node)}
          >
            {row.open ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
          </button>
          <Link
            to={wikiLink(projectId, node.path)}
            role="treeitem"
            tabIndex={node.id === tabStop ? 0 : -1}
            onFocus={() => setFocused(node.id)}
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            aria-expanded={row.expandable ? row.open : undefined}
            data-node-id={node.id}
            title={node.summary === "" ? rowTitle(node) : `${rowTitle(node)}\n\n${node.summary}`}
            className={cn(
              "flex min-w-0 flex-1 items-start gap-1.5 rounded-[var(--geist-radius)] px-1.5 py-1 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
              active ? "bg-hover text-text" : "text-text-secondary",
            )}
          >
            {node.kind === "folder" ? (
              row.open ? <FolderOpen className="mt-px size-4 shrink-0 text-text-muted" strokeWidth={1.5} /> : <Folder className="mt-px size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
            ) : (
              <FileText className="mt-px size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px]">{rowTitle(node)}</span>
          </Link>
        </div>
      </li>,
    );
    if (row.open) closing.push({ parentId: node.id, depth: row.depth + 1 });
  }
  flush(-1);

  return (
    <ul ref={list} role="tree" aria-label="Pages" className="flex flex-col" onKeyDown={onKeyDown}>
      {content}
    </ul>
  );
}
