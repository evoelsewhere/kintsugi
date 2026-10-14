// A file tree for a list of relative paths (folders collapse, one file is selected), like a code
// editor's explorer.

import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  files: string[];
}

function build(paths: readonly string[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const folderPath = node.path === "" ? part : `${node.path}/${part}`;
      let next = node.folders.find((folder) => folder.name === part);
      if (next === undefined) {
        next = { name: part, path: folderPath, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push(path);
  }
  const sort = (node: FolderNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.localeCompare(b));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export interface FileTreeProps {
  /** Relative POSIX paths. */
  paths: readonly string[];
  selected: string;
  onSelect: (path: string) => void;
}

export function FileTree({ paths, selected, onSelect }: FileTreeProps): React.JSX.Element {
  const root = useMemo(() => build(paths), [paths]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const row = "flex w-full items-center gap-1.5 rounded-[var(--geist-radius)] py-1 pr-2 text-left text-[13px] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]";

  const render = (node: FolderNode, depth: number): React.ReactNode => (
    <>
      {node.folders.map((folder) => {
        const open = !collapsed.has(folder.path);
        return (
          <li key={folder.path} role="none">
            <button type="button" role="treeitem" aria-expanded={open} className={cn(row, "text-text-secondary")} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(folder.path)}>
              {open ? <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} /> : <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />}
              {open ? <FolderOpen className="size-4 shrink-0" strokeWidth={1.5} /> : <Folder className="size-4 shrink-0" strokeWidth={1.5} />}
              <span className="truncate">{folder.name}</span>
            </button>
            {open ? <ul role="group">{render(folder, depth + 1)}</ul> : null}
          </li>
        );
      })}
      {node.files.map((path) => (
        <li key={path} role="none">
          <button
            type="button"
            role="treeitem"
            aria-selected={path === selected}
            className={cn(row, path === selected ? "bg-hover text-text" : "text-text-secondary")}
            style={{ paddingLeft: 8 + depth * 14 + 18 }}
            title={path}
            onClick={() => onSelect(path)}
          >
            <FileText className="size-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{path.split("/").at(-1)}</span>
          </button>
        </li>
      ))}
    </>
  );

  return (
    <ul role="tree" aria-label="Files" className="flex flex-col gap-px">
      {render(root, 0)}
    </ul>
  );
}
