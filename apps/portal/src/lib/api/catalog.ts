// Typed access to the item catalog of an application (ADR-0033). Mirrors apps/api →
// modules/delivery/catalog: the catalog path from the domain layout module with status derived from
// the understand runs and the understood items on the default branch.

import type { ItemAssetClass } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";
import type { StageResults } from "./documents";
import type { JobRunView } from "./job-runs";

export type ItemStatus = "running" | "in-pr" | "failed" | "stale" | "understood" | "not-analysed" | "retired";

export interface CatalogModule {
  id: string;
  name: string;
  summary: string;
}

export interface CatalogItem {
  /** `<module>/<item>`. */
  id: string;
  module: string;
  kind: string;
  name: string;
  summary: string;
  files: string[];
  leaves: string[];
  entryPoints: string[];
  loc: number;
  complexity: "low" | "medium" | "high";
  /** Test or generated code; older servers send none (see assetClassOf). */
  assetClass?: ItemAssetClass;
  digest: string;
  status: ItemStatus;
  aliases: string[];
  parts: Array<{ name: string; kind?: string; file?: string }>;
  lastRun?: { id: string; status: string; at: string };
  pr?: { runId: string; branch: string; url?: string };
  understood?: { commit?: string; runId?: string };
}

export interface CatalogView {
  ref: { ref: string; commit: string };
  catalog: { schemaVersion: number; app: string; source: { repo?: string; commit?: string }; modules: CatalogModule[]; unassigned: string[]; ambiguities: string[] };
  items: CatalogItem[];
  counts: Partial<Record<ItemStatus, number>>;
}

/** Mirrors apps/api → modules/delivery/catalog: the AI plan of what to understand next (ADR-0041). */
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
  dependsOutside: Array<{ item: string; usedBy: string[] }>;
}

export interface UnderstandPlan {
  version: number;
  strategy: string;
  catalog: { commit?: string; items: number; open: number };
  batches: PlanBatch[];
  leftOut: Array<{ item: string; reason: string }>;
  dropped: Array<{ item: string; reason: string }>;
  summary: { batches: number; planned: number; open: number };
}

export interface UnderstandPlanView {
  plan: UnderstandPlan | null;
  /** The catalog was reassessed since the plan. */
  stale: boolean;
  status: Record<string, ItemStatus>;
}

const app = (projectId: string, applicationId: string): string => `/api/projects/${encodeURIComponent(projectId)}/applications/${encodeURIComponent(applicationId)}`;

/** The result views of the understand stage. */
export type UnderstandView = "understand" | "map" | "extract-rules" | "harden";

/** A conflict of a refused selection (409): an item already running or in an open pull request. */
export interface SelectionConflict {
  item: string;
  runId?: string;
  state: string;
}

export const catalogApi = {
  /** The AI plan of what to understand next; `plan` is null before the first planning run. */
  plan: (projectId: string, applicationId: string) => apiGet<UnderstandPlanView>(`${app(projectId, applicationId)}/understand/plan`),
  get: (projectId: string, applicationId: string, ref?: string) => apiGet<CatalogView>(`${app(projectId, applicationId)}/catalog${ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`}`),
  /** Starts understand on items and whole modules (202); 409 with details.conflicts when some are blocked. */
  runUnderstand: (projectId: string, applicationId: string, selection: { items?: string[]; modules?: string[] }) => apiSend<JobRunView>(`${app(projectId, applicationId)}/understand/runs`, "POST", selection),
  /** The understand results as a view, for the whole application (generated views) or one item. */
  results: (projectId: string, applicationId: string, view: UnderstandView, item?: string, ref?: string) => {
    const query = new URLSearchParams({ view });
    if (item !== undefined) query.set("item", item);
    if (ref !== undefined) query.set("ref", ref);
    return apiGet<StageResults>(`${app(projectId, applicationId)}/understand/results?${query.toString()}`);
  },
};
