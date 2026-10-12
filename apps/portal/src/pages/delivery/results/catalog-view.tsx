// The Catalog tab of the assess stage (ADR-0033): the application's item catalog as a tree-table
// (module → items: kind, files, code lines, complexity, status), the files in no item and what the
// catalog scripts flagged for a person. Results first: the counts per status head the tab.

import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badges";
import { CheckMark } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import type { CatalogItem, CatalogView, ItemStatus } from "@/lib/api/catalog";
import { shortSha } from "@/lib/format";
import { ITEM_STATUS, styleOf } from "@/lib/status";
import { cn } from "@/lib/utils";
import { formatCount } from "./results-format";
import { Kpi, KpiRow, Section } from "./results-parts";

const STATUS_ORDER: ItemStatus[] = ["running", "in-pr", "failed", "stale", "understood", "not-analysed", "retired"];

export function ItemStatusBadge({ status }: { status: string }): React.JSX.Element {
  const style = styleOf(ITEM_STATUS, status);
  return <StatusBadge tone={style.tone} label={style.label} />;
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
  const groups = useMemo(() => {
    const names = new Map(view.catalog.modules.map((module) => [module.id, module]));
    const byModule = new Map<string, CatalogItem[]>();
    for (const item of view.items) byModule.set(item.module, [...(byModule.get(item.module) ?? []), item]);
    return [...byModule.entries()].map(([id, items]) => ({ id, name: names.get(id)?.name ?? id, summary: names.get(id)?.summary ?? "", items }));
  }, [view]);

  const toggleModule = (id: string): void =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]" aria-label="Item catalog">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-text-muted uppercase">
            {selection === undefined ? null : <th className="w-8 py-2" />}
            <th className="py-2 font-medium">Module / item</th>
            <th className="py-2 font-medium">Kind</th>
            <th className="py-2 text-right font-medium">Files</th>
            <th className="py-2 text-right font-medium">Code lines</th>
            <th className="py-2 font-medium">Complexity</th>
            <th className="py-2 font-medium">Status</th>
            {selection?.action === undefined ? null : <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const open = !collapsed.has(group.id);
            const selectable = selection === undefined ? [] : group.items.filter((item) => selection.blocked(item) === undefined).map((item) => item.id);
            const chosen = selectable.filter((id) => selection?.selected.has(id) === true).length;
            const loc = group.items.reduce((total, item) => total + item.loc, 0);
            const understood = group.items.filter((item) => item.status === "understood").length;
            return [
              <tr key={`m:${group.id}`} className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] bg-surface-subtle/40">
                {selection === undefined ? null : (
                  <td className="py-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={chosen === 0 ? false : chosen === selectable.length ? true : "mixed"}
                      aria-label={`Select module ${group.name}`}
                      disabled={selectable.length === 0}
                      onClick={() => selection.toggle(selectable, chosen < selectable.length)}
                      className="disabled:opacity-40"
                    >
                      <CheckMark checked={chosen > 0} />
                    </button>
                  </td>
                )}
                <td className="py-2" colSpan={1}>
                  <button type="button" className="flex items-center gap-1 font-medium text-text" onClick={() => toggleModule(group.id)} aria-expanded={open}>
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    {group.name}
                    <span className="font-mono text-[11px] font-normal text-text-muted">{group.id}</span>
                  </button>
                  {group.summary === "" ? null : <p className="ml-5 text-[12px] text-text-secondary">{group.summary}</p>}
                </td>
                <td className="py-2 text-text-muted">{group.items.length} items</td>
                <td className="py-2 text-right tabular-nums">{formatCount(group.items.reduce((total, item) => total + item.files.length, 0))}</td>
                <td className="py-2 text-right tabular-nums">{formatCount(loc)}</td>
                <td className="py-2" />
                <td className="py-2 text-[12px] text-text-secondary">
                  {understood}/{group.items.filter((item) => item.status !== "retired").length} understood
                </td>
                {selection?.action === undefined ? null : <td />}
              </tr>,
              ...(open
                ? group.items.map((item) => {
                    const reason = selection?.blocked(item);
                    return (
                      <tr key={item.id} className={cn("[box-shadow:0_-1px_0_rgba(0,0,0,0.04)]", item.status === "retired" && "text-text-muted")}>
                        {selection === undefined ? null : (
                          <td className="py-1.5">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={selection.selected.has(item.id)}
                              aria-label={`Select ${item.name}`}
                              title={reason}
                              disabled={reason !== undefined}
                              onClick={() => selection.toggle([item.id], !selection.selected.has(item.id))}
                              className="disabled:opacity-40"
                            >
                              <CheckMark checked={selection.selected.has(item.id)} />
                            </button>
                          </td>
                        )}
                        <td className="py-1.5 pl-5">
                          <p className="text-text">{item.name}</p>
                          <p className="font-mono text-[11px] text-text-muted">
                            {item.id}
                            {item.aliases.length === 0 ? "" : ` · was ${item.aliases.join(", ")}`}
                          </p>
                          {item.summary === "" ? null : <p className="text-[12px] text-text-secondary">{item.summary}</p>}
                          {item.parts.length === 0 ? null : <p className="text-[11px] text-text-muted">Parts: {item.parts.map((part) => part.name).join(", ")}</p>}
                        </td>
                        <td className="py-1.5">{item.kind}</td>
                        <td className="py-1.5 text-right tabular-nums" title={item.files.slice(0, 20).join("\n")}>
                          {formatCount(item.files.length)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(item.loc)}</td>
                        <td className="py-1.5">{item.complexity}</td>
                        <td className="py-1.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ItemStatusBadge status={item.status} />
                            {item.pr?.url === undefined ? null : (
                              <a className="text-[12px] underline" href={item.pr.url} target="_blank" rel="noreferrer">
                                PR
                              </a>
                            )}
                          </span>
                        </td>
                        {selection?.action === undefined ? null : <td className="py-1.5 text-right">{selection.action(item)}</td>}
                      </tr>
                    );
                  })
                : []),
            ];
          })}
        </tbody>
      </table>
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
        <Kpi label="Items" value={active.length} hint={`${view.catalog.modules.length} modules`} />
        <Kpi label="Understood" value={view.counts.understood ?? 0} display={`${view.counts.understood ?? 0}/${active.length}`} tone="green" />
        {STATUS_ORDER.filter((status) => status !== "understood" && (view.counts[status] ?? 0) > 0).map((status) => (
          <Kpi key={status} label={styleOf(ITEM_STATUS, status).label} value={view.counts[status] ?? 0} tone={styleOf(ITEM_STATUS, status).tone} />
        ))}
        <Kpi label="Unassigned files" value={view.catalog.unassigned.length} />
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
            <ul className="max-h-72 overflow-auto font-mono text-[12px] text-text-secondary">
              {view.catalog.unassigned.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Ambiguities" description="What the catalog scripts flagged for a person to check.">
          {view.catalog.ambiguities.length === 0 ? (
            <p className="text-[13px] text-text-muted">Nothing flagged.</p>
          ) : (
            <ul className="max-h-72 list-disc overflow-auto pl-5 text-[13px] text-text-secondary">
              {view.catalog.ambiguities.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
