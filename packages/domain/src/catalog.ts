import { assessmentCatalogPath, unitUnderstandingPath } from "./document-layout.js";

// The item catalog of an application (ADR-0033), written by the assess stage
// (scripts catalog_from_topology.py → apply_catalog_edits.py → reconcile_catalog.py → render_catalog.py)
// as Markdown: assessment/catalog/index.md and one file per module (ADR-0042).
// Module → item; a catalog item represents a unit whose full id is `<app>/<module>/<unit>`.
// Item status is derived (API), never stored in the catalog.

/** One kebab-case path segment: a module id, the item part of an item id, an application id. */
export const ITEM_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A catalog item id: `<module>/<item>` (the unit key of ADR-0031). */
export const CATALOG_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/;

/** Whether an item still exists in the application (`retired` items are kept, never deleted). */
export const CATALOG_ITEM_STATES = ["active", "retired"] as const;
export type CatalogItemState = (typeof CATALOG_ITEM_STATES)[number];

/**
 * The core item kinds (ADR-0060), by what an item is to the outside world. The first six are entry kinds
 * (how the system is triggered); `module` is the internal kind and the default. A project's `unitKinds` is the
 * list it allows and may add kinds of its own, which have no built-in specification profile.
 */
export const CORE_ITEM_KINDS = ["screen", "api", "batch-job", "report", "event", "integration", "module"] as const;
export type CoreItemKind = (typeof CORE_ITEM_KINDS)[number];

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
  /** Immutable abbreviation allocated by assess (ADR-0075). */
  code?: string;
  name: string;
  summary: string;
}

export interface CatalogItem {
  /** Published RULE/SEC/GAP scope, e.g. CARD01; independent of the canonical unit path. */
  referenceCode?: string;
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

/** Document-repo paths of the catalog's index and of an item's provenance record. */
export const catalogPath = (app: string): string => assessmentCatalogPath(app);
export const itemUnderstandingPath = (app: string, itemId: string): string => {
  const [module = "", unit = ""] = itemId.split("/");
  return unitUnderstandingPath(app, module, unit);
};

/**
 * What an item is made of: `test` (every file is a test), `generated` (every file is build output,
 * a generated source or a minified bundle) or `code`. Test and generated items are counted in the
 * size of an application but carry no behaviour to understand first.
 */
export const ITEM_ASSET_CLASSES = ["code", "test", "generated"] as const;
export type ItemAssetClass = (typeof ITEM_ASSET_CLASSES)[number];

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing|testdata|fixtures)\/|\.(test|spec)\.[a-z0-9]+$|(Tests?|IT)\.(java|kt|cs|scala|groovy)$|_test\.(go|py|rb|rs)$|(^|\/)test_[^/]+\.py$/i;
const GENERATED_PATH = /(^|\/)(generated|gen|build|dist|target|node_modules|vendor|__generated__)\/|\.min\.(js|css)$|\.pb\.go$|_pb2\.py$|\.generated\.[a-z0-9]+$|\.designer\.cs$/i;

/** The asset class of a catalog item from its files; an item without files is `code`. */
export function classifyItem(files: readonly string[]): ItemAssetClass {
  if (files.length === 0) return "code";
  if (files.every((file) => TEST_PATH.test(file))) return "test";
  if (files.every((file) => GENERATED_PATH.test(file))) return "generated";
  return "code";
}
