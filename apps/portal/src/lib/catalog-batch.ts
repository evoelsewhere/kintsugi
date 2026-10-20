// Choosing what to understand first and what it will cost: the asset class of a catalog item (test or
// generated code is not first), the recommended batch (risky, large, not blocked) and the run time
// estimated from the application's own earlier understand runs.

import { classifyItem, type ItemAssetClass } from "@kintsugi/domain";
import type { CatalogItem } from "./api/catalog";
import type { JobRunView } from "./api/job-runs";

/** The server's class when it sends one, else the same rule applied here. */
export const assetClassOf = (item: Pick<CatalogItem, "files"> & { assetClass?: ItemAssetClass }): ItemAssetClass => item.assetClass ?? classifyItem(item.files);

export const ASSET_CLASS_LABEL: Record<ItemAssetClass, string> = { code: "Code", test: "Test", generated: "Generated" };

/** Items a recommended batch holds at most, and the code lines it aims to stay under. */
export const BATCH_MAX_ITEMS = 5;
export const BATCH_MAX_LOC = 8000;

const COMPLEXITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const OPEN = new Set(["not-analysed", "failed", "stale"]);

export interface Batch {
  ids: string[];
  loc: number;
  high: number;
  /** The lines budget stopped the batch before the item cap did. */
  budgetHit: boolean;
}

/**
 * The items to understand next: code (not test or generated) that is not understood, running or in
 * a pull request, the most complex first, then the largest, until the item cap or the lines budget.
 * The first item is always taken, however large; the batch ends at the first item that does not fit,
 * so a small low-risk item never fills the room a larger one left.
 */
export function recommendBatch(items: readonly CatalogItem[], options: { maxItems?: number; maxLoc?: number } = {}): Batch {
  const maxItems = options.maxItems ?? BATCH_MAX_ITEMS;
  const maxLoc = options.maxLoc ?? BATCH_MAX_LOC;
  const candidates = items
    .filter((item) => OPEN.has(item.status) && assetClassOf(item) === "code")
    .sort((a, b) => COMPLEXITY_RANK[a.complexity] - COMPLEXITY_RANK[b.complexity] || b.loc - a.loc || a.id.localeCompare(b.id));
  const picked: CatalogItem[] = [];
  let loc = 0;
  let budgetHit = false;
  for (const item of candidates) {
    if (picked.length >= maxItems) break;
    if (picked.length > 0 && loc + item.loc > maxLoc) {
      budgetHit = true;
      break;
    }
    picked.push(item);
    loc += item.loc;
  }
  return { ids: picked.map((item) => item.id), loc, high: picked.filter((item) => item.complexity === "high").length, budgetHit };
}

export interface RunEstimate {
  /** Median run time per item over the earlier successful runs, and the total for the selection. */
  perItemMs: number;
  totalMs: number;
  /** How many earlier runs it rests on. */
  basis: number;
}

/** The time a selection takes, from the finished successful understand runs of the application; undefined without any. */
export function estimateRun(itemCount: number, runs: readonly JobRunView[]): RunEstimate | undefined {
  const perItem = runs
    .filter((run) => run.status === "succeeded" && run.startedAt !== undefined && run.finishedAt !== undefined && (run.scope?.items.length ?? 0) > 0)
    .map((run) => (new Date(run.finishedAt!).getTime() - new Date(run.startedAt!).getTime()) / run.scope!.items.length)
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  if (itemCount === 0 || perItem.length === 0) return undefined;
  const middle = Math.floor(perItem.length / 2);
  const median = perItem.length % 2 === 1 ? perItem[middle]! : (perItem[middle - 1]! + perItem[middle]!) / 2;
  return { perItemMs: median, totalMs: median * itemCount, basis: perItem.length };
}

/** "45 s", "12 min", "1 h 20 min". */
export function formatEstimate(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}
