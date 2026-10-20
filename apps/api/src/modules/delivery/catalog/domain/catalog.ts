// Domain of the item catalog (ADR-0033): `assess` writes the catalog through assessmentCatalogPath,
// with a status per catalog item derived — never stored — from `understand` runs and the default-branch evidence.
// Pure types and the derivation; reading the files and the runs is the application layer's job.

import type { ItemCatalog, ItemCatalogItem } from "@kintsugi/agents/reader";
import type { ItemAssetClass, ItemStatus } from "@kintsugi/domain";

/** Per-unit metadata written by `understand` for each specified catalog entry. */
export interface ItemMeta {
  digest?: string;
  /** Source commit the item was understood at. */
  commit?: string;
  /** The understand run that wrote it. */
  runId?: string;
}

/** What the derivation needs of an understand run. */
export interface UnderstandRunFacts {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  at: string;
  /** The items of its scope. */
  items: readonly string[];
  /** Items whose own step failed in an otherwise successful run (forEach keys). */
  failedItems: readonly string[];
  /** Its pull request, when the document write opened one. */
  pr?: { branch: string; url?: string; state: "open" | "merged" };
  abandoned: boolean;
}

/** A catalog item with its derived status (which replaces the catalog's active/retired). */
export interface CatalogItemView extends Omit<ItemCatalogItem, "status"> {
  /** Test or generated code, from the item's files; such items are not the first to understand. */
  assetClass: ItemAssetClass;
  /** The derived status; `retired` for items that no longer exist in the source. */
  status: ItemStatus;
  lastRun?: { id: string; status: UnderstandRunFacts["status"]; at: string };
  pr?: { runId: string; branch: string; url?: string };
  understood?: { commit?: string; runId?: string };
}

export interface CatalogView {
  ref: { ref: string; commit: string };
  catalog: Omit<ItemCatalog, "items">;
  items: CatalogItemView[];
  /** Items per status. */
  counts: Partial<Record<ItemStatus, number>>;
}

/**
 * The status of one item, by precedence: running > in-pr > failed > stale > understood >
 * not-analysed; retired stands beside them. `runs` are the application's understand runs, newest first.
 */
export function deriveItemStatus(item: ItemCatalogItem, meta: ItemMeta | undefined, runs: readonly UnderstandRunFacts[]): Pick<CatalogItemView, "status" | "lastRun" | "pr" | "understood"> {
  const touching = runs.filter((run) => run.items.includes(item.id));
  const latest = touching[0];
  const open = touching.find((run) => run.status === "succeeded" && run.pr?.state === "open" && !run.abandoned);
  const extra = {
    ...(latest === undefined ? {} : { lastRun: { id: latest.id, status: latest.status, at: latest.at } }),
    ...(open?.pr === undefined ? {} : { pr: { runId: open.id, branch: open.pr.branch, ...(open.pr.url === undefined ? {} : { url: open.pr.url }) } }),
    ...(meta === undefined ? {} : { understood: { ...(meta.commit === undefined ? {} : { commit: meta.commit }), ...(meta.runId === undefined ? {} : { runId: meta.runId }) } }),
  };
  const status = ((): ItemStatus => {
    if (item.status === "retired") return "retired";
    if (touching.some((run) => run.status === "queued" || run.status === "running")) return "running";
    if (open !== undefined) return "in-pr";
    if (latest !== undefined && latest.id !== meta?.runId && (latest.status === "failed" || latest.failedItems.includes(item.id))) return "failed";
    if (meta !== undefined) return meta.digest !== undefined && item.digest !== "" && meta.digest !== item.digest ? "stale" : "understood";
    return "not-analysed";
  })();
  return { status, ...extra };
}

/** Items a new understand run may not take: running, or in an open pull request nobody abandoned. */
export const isBlocked = (view: Pick<CatalogItemView, "status">): boolean => view.status === "running" || view.status === "in-pr";

/** One batch of the AI plan (ADR-0041), as the planning run checked and wrote it. */
export interface PlanBatch {
  n: number;
  title: string;
  rationale: string;
  risk: "high" | "medium" | "low";
  items: string[];
  loc: number;
  high: number;
  /** Calls inside the batch over all calls its items make to other items; null when they call none. */
  cohesion: number | null;
  /** Items outside the batch, not understood and not in an earlier batch, that its items depend on. */
  dependsOutside: Array<{ item: string; usedBy: string[] }>;
}

export interface UnderstandPlan {
  version: number;
  app: string;
  strategy: string;
  catalog: { commit?: string; items: number; open: number };
  batches: PlanBatch[];
  leftOut: Array<{ item: string; reason: string }>;
  dropped: Array<{ item: string; reason: string }>;
  summary: { batches: number; planned: number; open: number };
}

/** The plan with what the catalog says now: whether the plan still fits and where its items stand. */
export interface UnderstandPlanView {
  /** Null when no planning run has been merged yet. */
  plan: UnderstandPlan | null;
  /** The catalog was reassessed since the plan (its source commit differs). */
  stale: boolean;
  /** The derived status of every item the plan names, as of now. */
  status: Record<string, ItemStatus>;
}
