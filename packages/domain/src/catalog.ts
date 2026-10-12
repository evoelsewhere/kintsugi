// The item catalog of an application (ADR-0033): `assessment/<app>/catalog.json`, written by the
// assess stage (scripts catalog_from_topology.py → apply_catalog_edits.py → reconcile_catalog.py).
// Module → item; items are the units of work: the work item id is `<app>/<module>/<item>`.
// Item status is derived (API), never stored in the catalog.

/** One kebab-case path segment: a module id, the item part of an item id, an application id. */
export const ITEM_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A catalog item id: `<module>/<item>` (the unit key of ADR-0031). */
export const CATALOG_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/;

export const CATALOG_SCHEMA_VERSION = 1;

/** Whether an item still exists in the application (`retired` items are kept, never deleted). */
export const CATALOG_ITEM_STATES = ["active", "retired"] as const;
export type CatalogItemState = (typeof CATALOG_ITEM_STATES)[number];

export const COMPLEXITY_BANDS = ["low", "medium", "high"] as const;
export type ComplexityBand = (typeof COMPLEXITY_BANDS)[number];

/** A function or section inside an item: shown, never selectable. */
export interface CatalogItemPart {
  name: string;
  kind?: string;
  /** `path` or `path:line`, a file of the item. */
  file?: string;
}

export interface CatalogModule {
  id: string;
  name: string;
  summary: string;
}

export interface CatalogItem {
  /** `<module>/<item>`; stable across re-assessments. */
  id: string;
  /** The item's current module (the id keeps the module it was created in). */
  module: string;
  /** One of `unitKinds` of kintsugi.yaml. */
  kind: string;
  name: string;
  summary: string;
  /** Source files (repository paths); every inventory file is in exactly one active item or unassigned. */
  files: string[];
  /** Topology leaf ids the item was built from. */
  leaves: string[];
  /** Its leaves that are entry points of the application. */
  entryPoints: string[];
  /** Code lines. */
  loc: number;
  complexity: ComplexityBand;
  /** `sha256:<hex>` over the item's files and their per-file sha256; empty when unknown. */
  digest: string;
  status: CatalogItemState;
  /** Earlier names. */
  aliases: string[];
  parts: CatalogItemPart[];
}

export interface Catalog {
  schemaVersion: number;
  app: string;
  generatedBy?: string;
  source: { repo?: string; commit?: string };
  modules: CatalogModule[];
  items: CatalogItem[];
  /** Inventory files in no item. */
  unassigned: string[];
  /** What a person should check. */
  ambiguities: string[];
}

/**
 * The derived status of an item, in order of precedence: `running` > `in-pr` > `failed` > `stale` >
 * `understood` > `not-analysed`; `retired` stands beside them.
 */
export const ITEM_STATUSES = ["running", "in-pr", "failed", "stale", "understood", "not-analysed", "retired"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** The work item / unit id of a catalog item. */
export const workItemIdOf = (app: string, itemId: string): string => `${app}/${itemId}`;

/** Document-repo paths of the catalog and of an item's per-item files. */
export const catalogPath = (app: string): string => `assessment/${app}/catalog.json`;
export const itemMetaPath = (app: string, itemId: string): string => `knowledge/as-is/${app}/items/${itemId}/meta.json`;
