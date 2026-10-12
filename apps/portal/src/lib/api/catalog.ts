// Typed access to the item catalog of an application (ADR-0033). Mirrors apps/api →
// modules/delivery/catalog: `assessment/<app>/catalog.json` with a status per item derived from
// the understand runs and the understood items on the default branch.

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
