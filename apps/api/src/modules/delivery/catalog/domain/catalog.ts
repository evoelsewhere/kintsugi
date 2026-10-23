// Domain of the item catalog (ADR-0033, ADR-0042): `assess` writes the catalog Markdown under assessmentCatalogDir,
// with a status per catalog item derived — never stored — from `understand` runs and the default-branch evidence.
// Pure types and the derivation; reading the files and the runs is the application layer's job.

import type { ItemCatalog, ItemCatalogItem, PlanBatch, UnderstandPlan } from "@kintsugi/agents/reader";
import type { ItemAssetClass, ItemStatus } from "@kintsugi/domain";

/** The provenance record (`understanding.md` in the unit's legacy folder) `understand` writes for each specified catalog entry. */
export interface ItemMeta {
  digest?: string;
  /** Source commit the item was understood at. */
  commit?: string;
  /** The understand run that wrote it. */
  runId?: string;
  /** The specification profile it was written with (`profile: <kind>@<version>`, ADR-0060). */
  profile?: { kind: string; version: number };
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
  /** Why an item is `stale`: its files changed (`source`), or its kind's specification profile was raised since (`profile`). */
  staleReason?: "source" | "profile";
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
export function deriveItemStatus(
  item: ItemCatalogItem,
  meta: ItemMeta | undefined,
  runs: readonly UnderstandRunFacts[],
  /** The current version of the specification profile of each item kind (ADR-0060). */
  profiles?: ReadonlyMap<string, number>,
): Pick<CatalogItemView, "status" | "lastRun" | "pr" | "understood" | "staleReason"> {
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
    if (meta !== undefined) return staleReason(item, meta, profiles) === undefined ? "understood" : "stale";
    return "not-analysed";
  })();
  const reason = status === "stale" && meta !== undefined ? staleReason(item, meta, profiles) : undefined;
  return { status, ...extra, ...(reason === undefined ? {} : { staleReason: reason }) };
}

/**
 * Why an understood item is stale: its digest moved away from the record (`source`), or the specification was written
 * with a profile that is not the current one of its kind (`profile`: a newer version, or another kind after a kind
 * change). A specification recorded without a profile is not stale for that reason.
 */
function staleReason(item: ItemCatalogItem, meta: ItemMeta, profiles: ReadonlyMap<string, number> | undefined): "source" | "profile" | undefined {
  if (meta.digest !== undefined && item.digest !== "" && meta.digest !== item.digest) return "source";
  const current = profiles?.get(item.kind);
  if (meta.profile !== undefined && current !== undefined && (meta.profile.kind !== item.kind || meta.profile.version < current)) return "profile";
  return undefined;
}

/** Items a new understand run may not take: running, or in an open pull request nobody abandoned. */
export const isBlocked = (view: Pick<CatalogItemView, "status">): boolean => view.status === "running" || view.status === "in-pr";

/** The AI plan (ADR-0041) as the planning run checked and wrote it (`01-legacy/plan.md`): the reader's types. */
export type { PlanBatch, UnderstandPlan };

/** The plan with what the catalog says now: whether the plan still fits and where its items stand. */
export interface UnderstandPlanView {
  /** Null when no planning run has been merged yet. */
  plan: UnderstandPlan | null;
  /** The catalog was reassessed since the plan (its source commit differs). */
  stale: boolean;
  /** The derived status of every item the plan names, as of now. */
  status: Record<string, ItemStatus>;
}
