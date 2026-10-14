// File browser — the file tree beside a read-only code view, like an editor's project view. The
// caller owns the contents (loaded up front or per file) and passes the selected file's text.

import { FileTree } from "@/components/file-tree";
import { CodeView } from "@/components/code/code-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
}

export function FileBrowser({ title, paths, selected, onSelect, text, error = null, className }: FileBrowserProps): React.JSX.Element {
  return (
    <div className={cn("flex h-[calc(100vh-17rem)] min-h-96 overflow-hidden rounded-[var(--geist-radius)] shadow-border", className)}>
      <nav aria-label={`${title} files`} className="w-64 shrink-0 overflow-auto p-2 [box-shadow:1px_0_0_rgba(0,0,0,0.08)]">
        <p className="truncate px-2 pb-1.5 text-[11px] tracking-wide text-text-muted uppercase">{title}</p>
        <FileTree paths={paths} selected={selected} onSelect={onSelect} />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[12px] text-text-secondary [box-shadow:0_1px_0_rgba(0,0,0,0.08)]">
          <span className="truncate">{selected}</span>
          {text === undefined ? null : <span className="shrink-0 text-text-muted">{text.split("\n").length} lines</span>}
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
          ) : (
            <CodeView text={text} path={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
