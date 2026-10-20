// The Catalog tab of the assess stage (ADR-0033): the application's item catalog as a tree-table
// (module → items: kind, files, code lines, complexity, status), the files in no item and what the
// catalog scripts flagged for a person. Results first: the counts per status head the tab.

import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badges";
import { CheckMark } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import type { CatalogItem, CatalogView, ItemStatus } from "@/lib/api/catalog";
import { assetClassOf, ASSET_CLASS_LABEL } from "@/lib/catalog-batch";
import { shortSha } from "@/lib/format";
import { ITEM_STATUS, styleOf } from "@/lib/status";
import { cn } from "@/lib/utils";
import { formatCount } from "./results-format";
import { Kpi, KpiRow, Section } from "./results-parts";

const COMPLEXITY_TONE: Record<CatalogItem["complexity"], StatusTone> = {
  low: "green",
  medium: "orange",
  high: "red",
};

const FOCUS = "focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]";

const STATUS_ORDER: ItemStatus[] = ["running", "in-pr", "failed", "stale", "understood", "not-analysed", "retired"];

const plural = (count: number, noun: string): string => `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;

/** Unassigned files grouped by their first folder (root files together), biggest group first. */
function groupByFolder(paths: readonly string[]): Array<{ folder: string; paths: string[] }> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const folder = path.includes("/") ? path.slice(0, path.indexOf("/")) : "(repository root)";
    groups.set(folder, [...(groups.get(folder) ?? []), path]);
  }
  return [...groups.entries()].map(([folder, list]) => ({ folder, paths: list })).sort((a, b) => b.paths.length - a.paths.length || a.folder.localeCompare(b.folder));
}

export function ItemStatusBadge({ status }: { status: string }): React.JSX.Element {
  const style = styleOf(ITEM_STATUS, status);
  return <StatusBadge tone={style.tone} label={style.label} busy={style.busy} />;
}

export interface CatalogSelection {
  selected: ReadonlySet<string>;
  /** Why an item cannot be selected; undefined when it can. */
  blocked(item: CatalogItem): string | undefined;
  toggle(ids: readonly string[], on: boolean): void;
  /** Shown at the end of an item's row (e.g. Abandon). */
  action?(item: CatalogItem): React.ReactNode;
}

export function CatalogTree({ view, selection }: { view: CatalogView; selection?: CatalogSelection }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ItemStatus | "all">("all");
  const maxLoc = useMemo(() => Math.max(1, ...view.items.map((item) => item.loc)), [view]);
  const kinds = useMemo(() => new Set(view.items.map((item) => item.kind)), [view]);
  const statusesPresent = STATUS_ORDER.filter((candidate) => (view.counts[candidate] ?? 0) > 0);
  const filtering = query.trim() !== "" || status !== "all";
  const groups = useMemo(() => {
    const names = new Map(view.catalog.modules.map((module) => [module.id, module]));
    const needle = query.trim().toLowerCase();
    const matches = (item: CatalogItem): boolean =>
      (status === "all" || item.status === status) && (needle === "" || `${item.name} ${item.id} ${item.summary}`.toLowerCase().includes(needle) || item.files.some((file) => file.toLowerCase().includes(needle)));
    const byModule = new Map<string, CatalogItem[]>();
    for (const item of view.items) if (matches(item)) byModule.set(item.module, [...(byModule.get(item.module) ?? []), item]);
    return [...byModule.entries()].map(([id, items]) => ({
      id,
      name: names.get(id)?.name ?? id,
      summary: names.get(id)?.summary ?? "",
      items,
    }));
  }, [view, query, status]);

  const toggleModule = (id: string): void =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, summary or file"
          aria-label="Filter items"
          className={cn("w-full rounded-[6px] bg-recessed py-1.5 pr-2 pl-7 text-[12.5px] text-text placeholder:text-text-muted", FOCUS)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
        {(["all", ...statusesPresent] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={status === candidate}
            onClick={() => setStatus(candidate)}
            className={cn("rounded-full px-2.5 py-1 text-[11.5px] tabular-nums", status === candidate ? "bg-hover font-medium text-text" : "text-text-muted hover:bg-hover", FOCUS)}
          >
            {candidate === "all" ? `All ${view.items.length}` : `${styleOf(ITEM_STATUS, candidate).label} ${view.counts[candidate] ?? 0}`}
          </button>
        ))}
      </div>
      <span className="ml-auto flex items-center gap-1">
        <button type="button" title="Collapse all modules" aria-label="Collapse all modules" onClick={() => setCollapsed(new Set(groups.map((group) => group.id)))} className={cn("rounded-[6px] p-1.5 text-text-muted hover:bg-hover", FOCUS)}>
          <ChevronsDownUp className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" title="Expand all modules" aria-label="Expand all modules" onClick={() => setCollapsed(new Set())} className={cn("rounded-[6px] p-1.5 text-text-muted hover:bg-hover", FOCUS)}>
          <ChevronsUpDown className="size-3.5" strokeWidth={1.75} />
        </button>
      </span>
    </div>
  );

  return (
    <div>
      {toolbar}
      {groups.length === 0 ? <p className="py-6 text-center text-[13px] text-text-muted">No item matches the filter.</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]" aria-label="Item catalog">
          <thead>
            <tr className="text-left text-[10px] tracking-wide text-text-muted uppercase">
              {selection === undefined ? null : <th className="w-8 px-1.5 py-2" />}
              <th className="px-2 py-2 font-medium">Module / item</th>
              {kinds.size > 1 ? <th className="px-2 py-2 font-medium">Kind</th> : null}
              <th className="w-16 px-2 py-2 text-right font-medium">Files</th>
              <th className="w-40 px-2 py-2 text-right font-medium">Code lines</th>
              <th className="w-28 px-2 py-2 font-medium">Complexity</th>
              <th className="px-2 py-2 font-medium">Status</th>
              {selection?.action === undefined ? null : <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const open = filtering || !collapsed.has(group.id);
              const selectable = selection === undefined ? [] : group.items.filter((item) => selection.blocked(item) === undefined).map((item) => item.id);
              const chosen = selectable.filter((id) => selection?.selected.has(id) === true).length;
              const loc = group.items.reduce((total, item) => total + item.loc, 0);
              const understood = group.items.filter((item) => item.status === "understood").length;
              return [
                <tr key={`m:${group.id}`} className="bg-recessed/60 [box-shadow:0_-1px_0_var(--color-hover)]">
                  {selection === undefined ? null : (
                    <td className="px-1.5 py-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={chosen === 0 ? false : chosen === selectable.length ? true : "mixed"}
                        aria-label={`Select module ${group.name}`}
                        disabled={selectable.length === 0}
                        onClick={() => selection.toggle(selectable, chosen < selectable.length)}
                        className={cn("rounded-[4px] disabled:cursor-not-allowed disabled:opacity-40", FOCUS)}
                      >
                        <CheckMark checked={chosen > 0} />
                      </button>
                    </td>
                  )}
                  <td className="px-2 py-2" colSpan={1}>
                    <button type="button" className={cn("flex max-w-full items-center gap-1.5 rounded-[6px] font-medium text-text", FOCUS)} onClick={() => toggleModule(group.id)} aria-expanded={open} title={group.name}>
                      {open ? <ChevronDown className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} /> : <ChevronRight className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />}
                      <span className="truncate">{group.name}</span>
                      <span className="shrink-0 font-mono text-[11px] font-normal text-text-muted">{group.id}</span>
                    </button>
                    {group.summary === "" ? null : (
                      <p className="ml-5 line-clamp-2 text-[12px] text-text-secondary" title={group.summary}>
                        {group.summary}
                      </p>
                    )}
                  </td>
                  {kinds.size > 1 ? <td className="px-2 py-2 text-[11.5px] text-text-muted tabular-nums">{plural(group.items.length, "item")}</td> : null}
                  <td className="px-2 py-2 text-right text-[11.5px] text-text-secondary tabular-nums">{formatCount(group.items.reduce((total, item) => total + item.files.length, 0))}</td>
                  <td className="px-2 py-2 text-right text-[11.5px] text-text-secondary tabular-nums">{formatCount(loc)}</td>
                  <td className="px-2 py-2 text-[11.5px] text-text-muted tabular-nums">{kinds.size > 1 ? null : plural(group.items.length, "item")}</td>
                  <td className="px-2 py-2 text-[11.5px] text-text-secondary tabular-nums">
                    {understood}/{group.items.filter((item) => item.status !== "retired").length} understood
                  </td>
                  {selection?.action === undefined ? null : <td />}
                </tr>,
                ...(open
                  ? group.items.map((item) => {
                      const reason = selection?.blocked(item);
                      const picked = selection?.selected.has(item.id) === true;
                      return (
                        <tr key={item.id} className={cn("align-top [box-shadow:0_-1px_0_var(--color-hover)] focus-within:bg-hover hover:bg-hover", picked && "bg-hover", item.status === "retired" && "text-text-muted")}>
                          {selection === undefined ? null : (
                            <td className="px-1.5 py-2">
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={selection.selected.has(item.id)}
                                aria-label={`Select ${item.name}`}
                                title={reason}
                                disabled={reason !== undefined}
                                onClick={() => selection.toggle([item.id], !selection.selected.has(item.id))}
                                className={cn("rounded-[4px] disabled:cursor-not-allowed disabled:opacity-40", FOCUS)}
                              >
                                <CheckMark checked={selection.selected.has(item.id)} />
                              </button>
                            </td>
                          )}
                          <td className="max-w-[360px] px-2 py-2 pl-7">
                            <p className="truncate text-[13px] font-medium text-text" title={item.name}>
                              {item.name}
                              <span className="ml-1.5 font-mono text-[11px] font-normal text-text-muted">{item.id}</span>
                              {assetClassOf(item) === "code" ? null : (
                                <span className="ml-1.5 rounded-full bg-hover px-1.5 py-0.5 text-[10.5px] font-normal text-text-secondary" title={`${ASSET_CLASS_LABEL[assetClassOf(item)]} code: counted in the size, not the first to understand`}>
                                  {assetClassOf(item)}
                                </span>
                              )}
                            </p>
                            {item.summary === "" ? null : (
                              <p className="line-clamp-2 text-[12px] text-text-secondary" title={item.summary}>
                                {item.summary}
                              </p>
                            )}
                            {item.aliases.length === 0 && item.parts.length === 0 ? null : (
                              <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
                                {item.aliases.length === 0 ? null : (
                                  <span className="rounded-full bg-hover px-1.5 py-0.5 font-mono" title={`Previously ${item.aliases.join(", ")}`}>
                                    was {item.aliases.join(", ")}
                                  </span>
                                )}
                                {item.parts.map((part) => (
                                  <span key={part.name} className="rounded-full bg-hover px-1.5 py-0.5" title={part.file ?? part.kind}>
                                    {part.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          {kinds.size > 1 ? <td className="px-2 py-2 text-[12px] text-text-secondary">{item.kind}</td> : null}
                          <td className="px-2 py-2 text-right text-[11.5px] text-text-secondary tabular-nums" title={item.files.slice(0, 20).join("\n")}>
                            {formatCount(item.files.length)}
                          </td>
                          <td className="px-2 py-2 text-right text-[11.5px] text-text-secondary tabular-nums" title={`${Math.round((item.loc / maxLoc) * 100)}% of the largest item`}>
                            <span className="inline-flex items-center justify-end gap-2">
                              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-hover" aria-hidden="true">
                                <span
                                  className="block h-full rounded-full bg-text-muted/60"
                                  style={{
                                    width: `${Math.max(2, (item.loc / maxLoc) * 100)}%`,
                                  }}
                                />
                              </span>
                              {formatCount(item.loc)}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
                              <StatusDot tone={COMPLEXITY_TONE[item.complexity]} className="size-2" />
                              {item.complexity}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <ItemStatusBadge status={item.status} />
                              {item.pr?.url === undefined ? null : (
                                <a className={cn("rounded-[4px] text-[12px] text-accent hover:underline", FOCUS)} href={item.pr.url} target="_blank" rel="noreferrer">
                                  PR
                                </a>
                              )}
                            </span>
                          </td>
                          {selection?.action === undefined ? null : <td className="px-2 py-2 text-right">{selection.action(item)}</td>}
                        </tr>
                      );
                    })
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The catalog headline, tree, unassigned files and ambiguities. `children` go above the tree (selection bar). */
export function CatalogResults({ view, selection, children }: { view: CatalogView; selection?: CatalogSelection; children?: React.ReactNode }): React.JSX.Element {
  const active = view.items.filter((item) => item.status !== "retired");
  if (view.items.length === 0) {
    return <EmptyState icon={ListTree} title="The catalog has no items" description="The assess stage found no topology leaf with a file of the inventory." />;
  }
  return (
    <div className="flex flex-col gap-5">
      <KpiRow>
        <Kpi label="Items" value={active.length} hint={plural(new Set(active.map((item) => item.module)).size, "module")} />
        <Kpi label="Understood" value={view.counts.understood ?? 0} display={`${view.counts.understood ?? 0}/${active.length}`} tone="green" />
        {STATUS_ORDER.filter((status) => status !== "understood" && (view.counts[status] ?? 0) > 0).map((status) => (
          <Kpi key={status} label={styleOf(ITEM_STATUS, status).label} value={view.counts[status] ?? 0} tone={styleOf(ITEM_STATUS, status).tone} />
        ))}
        <Kpi label="Unassigned files" value={view.catalog.unassigned.length} hint={`${formatCount(active.reduce((total, item) => total + item.files.length, 0))} files in items`} />
        <Kpi label="Code lines" value={active.reduce((total, item) => total + item.loc, 0)} hint={`${formatCount(active.filter((item) => assetClassOf(item) !== "code").reduce((total, item) => total + item.loc, 0))} in test or generated items`} />
      </KpiRow>
      <Section
        title="Item catalog"
        description={`Module → item, from the extracted topology and the curation pass${view.catalog.source.commit === undefined ? "" : ` · source ${shortSha(view.catalog.source.commit)}`} · read at ${shortSha(view.ref.commit)}`}
      >
        {children}
        <CatalogTree view={view} {...(selection === undefined ? {} : { selection })} />
      </Section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Unassigned files" description="Inventory files in no item: documentation, build files, or code the topology did not place.">
          {view.catalog.unassigned.length === 0 ? (
            <p className="text-[13px] text-text-muted">Every file is in an item.</p>
          ) : (
            <div className="max-h-72 overflow-auto">
              {groupByFolder(view.catalog.unassigned).map((group) => (
                <details key={group.folder} open={group.paths.length <= 3}>
                  <summary className={cn("flex cursor-pointer items-center justify-between rounded-[4px] px-1.5 py-1 text-[12.5px] text-text hover:bg-hover", FOCUS)}>
                    <span className="font-mono">{group.folder}</span>
                    <span className="text-[11px] text-text-muted tabular-nums">{plural(group.paths.length, "file")}</span>
                  </summary>
                  <ul className="mb-1 ml-3 font-mono text-[11.5px] text-text-secondary">
                    {group.paths.map((path) => (
                      <li key={path} className="truncate rounded-[4px] px-1.5 py-0.5 hover:bg-hover" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </Section>
        <Section title="Ambiguities" description="What the catalog scripts flagged for a person to check.">
          {view.catalog.ambiguities.length === 0 ? (
            <p className="text-[13px] text-text-muted">Nothing flagged.</p>
          ) : (
            <ul className="max-h-72 list-disc overflow-auto pl-5 text-[13px] text-text-secondary">
              {view.catalog.ambiguities.map((line, index) => (
                <li key={index} className="py-0.5 break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
