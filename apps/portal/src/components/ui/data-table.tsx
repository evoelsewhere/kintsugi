// DataTable — the one table of the portal's result views: sortable columns, a search box,
// optional filters (the toolbar slot), pagination and clickable rows. DESIGN.md: 13px rows,
// 11px uppercase muted headers, hairline row separators, no zebra fills.

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** The value a click on the header sorts by; the column is not sortable without one. */
  sort?: (row: T) => string | number | undefined;
  /** Text the search box matches; defaults to a string sort value. */
  search?: (row: T) => string;
  align?: "left" | "right";
  className?: string;
  /** Header tooltip. */
  title?: string;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  label: string;
  /** Shows a search box with this placeholder. */
  searchPlaceholder?: string;
  initialSort?: { id: string; desc?: boolean };
  /** Rows per page; 0 shows every row. */
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /** Highlights the selected row. */
  selectedKey?: string | undefined;
  rowClassName?: (row: T) => string | undefined;
  /** Filters and actions next to the search box. */
  toolbar?: React.ReactNode;
  /** Shown when no row matches. */
  empty?: React.ReactNode;
  className?: string;
  minWidth?: number;
}

const compare = (a: string | number | undefined, b: string | number | undefined): number => {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  searchPlaceholder,
  initialSort,
  pageSize = 25,
  onRowClick,
  selectedKey,
  rowClassName,
  toolbar,
  empty,
  className,
  minWidth = 640,
}: DataTableProps<T>): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; desc: boolean } | undefined>(initialSort === undefined ? undefined : { id: initialSort.id, desc: initialSort.desc ?? false });
  const [page, setPage] = useState(0);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const textOf = (column: Column<T>, row: T): string => {
      if (column.search !== undefined) return column.search(row);
      const value = column.sort?.(row);
      return typeof value === "string" ? value : "";
    };
    const searchable = (row: T): string =>
      columns
        .map((column) => textOf(column, row))
        .join(" ")
        .toLowerCase();
    const matching = needle === "" ? [...rows] : rows.filter((row) => searchable(row).includes(needle));
    const column = sort === undefined ? undefined : columns.find((entry) => entry.id === sort.id);
    if (column?.sort !== undefined) {
      const by = column.sort;
      matching.sort((a, b) => (sort?.desc === true ? -1 : 1) * compare(by(a), by(b)));
    }
    return matching;
  }, [rows, columns, query, sort]);

  const pages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = pageSize === 0 ? shown : shown.slice(current * pageSize, (current + 1) * pageSize);

  function toggle(column: Column<T>): void {
    if (column.sort === undefined) return;
    setSort((previous) => (previous?.id === column.id ? { id: column.id, desc: !previous.desc } : { id: column.id, desc: false }));
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {searchPlaceholder === undefined && toolbar === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder === undefined ? null : (
            <label className="shadow-border flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-[var(--geist-radius)] px-2.5 sm:max-w-xs">
              <Search className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-muted"
              />
            </label>
          )}
          {toolbar}
          <span className="ml-auto text-[12px] text-text-muted">
            {shown.length === rows.length ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}` : `${shown.length} of ${rows.length}`}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full text-left text-[13px]" style={{ minWidth }}>
          <thead className="text-[11px] tracking-wide text-text-muted uppercase">
            <tr>
              {columns.map((column) => {
                const active = sort?.id === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    title={column.title}
                    aria-sort={active ? (sort?.desc === true ? "descending" : "ascending") : undefined}
                    className={cn("px-2 py-1.5 font-normal first:pl-3 last:pr-3", column.align === "right" && "text-right", column.className)}
                  >
                    {column.sort === undefined ? (
                      column.header
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(column)}
                        className={cn("inline-flex items-center gap-1 uppercase hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]", active && "text-text")}
                      >
                        {column.header}
                        {active ? sort?.desc === true ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                <td colSpan={columns.length} className="px-3 py-6 text-center text-[12px] text-text-muted">
                  {empty ?? (query === "" ? "Nothing to show." : `No row matches “${query}”.`)}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                    onKeyDown={
                      onRowClick === undefined
                        ? undefined
                        : (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                    }
                    tabIndex={onRowClick === undefined ? undefined : 0}
                    aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                    className={cn(
                      "align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]",
                      onRowClick !== undefined && "cursor-pointer hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
                      selectedKey === key && "bg-hover",
                      rowClassName?.(row),
                    )}
                  >
                    {columns.map((column) => (
                      <td key={column.id} className={cn("px-2 py-2 first:pl-3 last:pr-3", column.align === "right" && "text-right tabular-nums", column.className)}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pages <= 1 ? null : (
        <div className="flex items-center justify-end gap-2 text-[12px] text-text-muted">
          <span>
            {current * pageSize + 1}–{Math.min(shown.length, (current + 1) * pageSize)} of {shown.length}
          </span>
          <Button size="icon" variant="ghost" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
