/**
 * The document-repo path layout, grouped by bounded context (ADR-0042; it replaces the tree of
 * ADR-0038). Keep path construction here so callers never encode the layout themselves.
 *
 *   applications/<app>/
 *     inputs/                what people attach
 *     assessment/            Assessment context: what the estate is (inventory, topology, catalog)
 *     understanding/         Understanding context at application level (the plan)
 *     units/<module>/<unit>/ the Unit aggregate: unit.md is its root, understanding/ holds what is known
 *     generated/             read models rebuilt after a merge
 *   scratch/<app>/           job-to-job data of one run; outside the layout, never committed
 *
 * The document repo holds no JSON: committed files are Markdown (docs/reference/document-formats.md).
 */
const APPLICATIONS_ROOT = "applications";
const SCRATCH_ROOT = "scratch";
const APP_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const DOCUMENT_PATH_TOKENS = {
  app: "{app}",
  module: "{module}",
  unit: "{unit}",
  item: "{item}",
  run: "{run}",
} as const;

/** Paths committed straight to the default branch by kintsugi-bot (ADR-0019, ADR-0042). */
export const DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS: readonly string[] = [
  "applications/*/units/**/unit.md",
  "applications/*/units/**/task.md",
  "applications/*/generated/**",
  // The AI plan for what to understand next: advice, replaced by every planning run.
  "applications/*/understanding/plan.md",
];

export function applicationsDir(): string {
  return APPLICATIONS_ROOT;
}

export function applicationDir(app: string): string {
  return `${applicationsDir()}/${app}`;
}

export function applicationInputsDir(app: string): string {
  return `${applicationDir(app)}/inputs`;
}

export function applicationInputPath(app: string, file: string): string {
  return `${applicationInputsDir(app)}/${file}`;
}

export function applicationToBeDir(app: string): string {
  return `${applicationDir(app)}/to-be`;
}

export function applicationRequirementsPath(app: string): string {
  return `${applicationToBeDir(app)}/requirements.md`;
}

export function applicationDesignPath(app: string): string {
  return `${applicationToBeDir(app)}/design.md`;
}

export function applicationGatesDir(app: string): string {
  return `${applicationDir(app)}/gates`;
}

export function applicationGatePath(app: string, gate: string): string {
  return `${applicationGatesDir(app)}/${gate}.md`;
}

export function applicationCutoverDir(app: string): string {
  return `${applicationDir(app)}/cutover`;
}

export function applicationCutoverFilePath(app: string, file: string): string {
  return `${applicationCutoverDir(app)}/${file}`;
}

export function applicationOperateDir(app: string): string {
  return `${applicationDir(app)}/operate`;
}

export function applicationOperateFilePath(app: string, file: string): string {
  return `${applicationOperateDir(app)}/${file}`;
}

// ---------------------------------------------------------------------------
// Assessment context
// ---------------------------------------------------------------------------

export function assessmentDir(app: string): string {
  return `${applicationDir(app)}/assessment`;
}

export function assessmentFilePath(app: string, file: string): string {
  return `${assessmentDir(app)}/${file}`;
}

/** The measured inventory, summarised: languages, folders, the most complex files. */
export function assessmentInventoryPath(app: string): string {
  return assessmentFilePath(app, "inventory.md");
}

/** The topology, summarised: modules, the edges between them, entry points, flows. */
export function assessmentTopologyPath(app: string): string {
  return assessmentFilePath(app, "topology.md");
}

export function assessmentCatalogDir(app: string): string {
  return assessmentFilePath(app, "catalog");
}

/** The catalog's index: its modules and items, one table row each. */
export function assessmentCatalogPath(app: string): string {
  return `${assessmentCatalogDir(app)}/index.md`;
}

/** One module's items, one section each: summary, files, dependencies. */
export function assessmentCatalogModulePath(app: string, module: string): string {
  return `${assessmentCatalogDir(app)}/${module}.md`;
}

export function assessmentAnalysisDir(app: string): string {
  return assessmentFilePath(app, "analysis");
}

export function assessmentToolsDir(app: string): string {
  return assessmentFilePath(app, "tools");
}

export function topologyExtractorPath(app: string): string {
  return `${assessmentToolsDir(app)}/extract_topology.py`;
}

// ---------------------------------------------------------------------------
// Understanding context
// ---------------------------------------------------------------------------

export function applicationUnderstandingDir(app: string): string {
  return `${applicationDir(app)}/understanding`;
}

/** The checked plan of what to understand next, batch by batch (auto-committed advice). */
export function understandPlanPath(app: string): string {
  return `${applicationUnderstandingDir(app)}/plan.md`;
}

// ---------------------------------------------------------------------------
// Scratch: job-to-job data of one run (JSON, never committed, not part of the layout)
// ---------------------------------------------------------------------------

export function scratchDir(app: string): string {
  return `${SCRATCH_ROOT}/${app}`;
}

export function scratchFilePath(app: string, file: string): string {
  return `${scratchDir(app)}/${file}`;
}

/** The raw inventory (one entry per source file) the catalog scripts read. */
export function scratchInventoryPath(app: string): string {
  return scratchFilePath(app, "inventory.json");
}

/** The raw topology (tree and every edge) the extraction script writes. */
export function scratchTopologyPath(app: string): string {
  return scratchFilePath(app, "topology.json");
}

/** The catalog proposal, the curation edits and the curated catalog of an assess run. */
export function scratchCatalogDraftDir(app: string): string {
  return scratchFilePath(app, "catalog-draft");
}

/** The catalog an assess run settled on, before it is rendered to Markdown. */
export function scratchCatalogPath(app: string): string {
  return scratchFilePath(app, "catalog.json");
}

export function understandRunDir(app: string): string {
  return scratchFilePath(app, "understand");
}

export function understandRunFilePath(app: string, file: string): string {
  return `${understandRunDir(app)}/${file}`;
}

export function understandScopePath(app: string): string {
  return understandRunFilePath(app, "scope.json");
}

/** The item graph a planning run computes from the catalog (intermediate). */
export function understandGraphPath(app: string): string {
  return understandRunFilePath(app, "graph.json");
}

/** The planner's own answer before it is checked against the catalog (intermediate). */
export function understandPlanDraftPath(app: string): string {
  return understandRunFilePath(app, "plan-draft.json");
}

export function assessmentBriefsDir(app: string): string {
  return `${understandRunDir(app)}/briefs`;
}

/** Per-unit brief written by scope_items.py; `unitKey` is `<module>/<unit>`. */
export function assessmentBriefPath(app: string, unitKey: string): string {
  return `${assessmentBriefsDir(app)}/${unitKey}.json`;
}

/** The trace fragment a specification job returns for one unit (intermediate). */
export function understandTraceDraftPath(app: string, unitKey: string): string {
  return understandRunFilePath(app, `trace/${unitKey}.json`);
}

// ---------------------------------------------------------------------------
// Generated read models
// ---------------------------------------------------------------------------

/** Application aggregates rebuilt from authored unit documents. */
export function generatedDir(app: string): string {
  return `${applicationDir(app)}/generated`;
}

export function generatedFilePath(app: string, file: string): string {
  return `${generatedDir(app)}/${file}`;
}

// ---------------------------------------------------------------------------
// The Unit aggregate
// ---------------------------------------------------------------------------

/** Application id for one of the per-unit paths, if the path belongs to an application. */
export function appFromUnitPath(path: string): string | undefined {
  const segments = path.split("/");
  const app = segments[0] === APPLICATIONS_ROOT && segments[2] === "units" && segments.length >= 5 ? segments[1] : undefined;
  return app !== undefined && APP_SEGMENT_PATTERN.test(app) ? app : undefined;
}

export function unitsDir(app: string): string {
  return `${applicationDir(app)}/units`;
}

export function unitModuleDir(app: string, module: string): string {
  return `${unitsDir(app)}/${module}`;
}

export function unitDir(app: string, module: string, unit: string): string {
  return `${unitModuleDir(app, module)}/${unit}`;
}

export function unitFilePath(app: string, module: string, unit: string, file: string): string {
  return `${unitDir(app, module, unit)}/${file}`;
}

/** The aggregate root: the unit's state (front matter) and gate references. */
export function unitStatePath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "unit.md");
}

/** What is known about the unit, written by the understanding context. */
export function unitUnderstandingDir(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "understanding");
}

export function unitUnderstandingFilePath(app: string, module: string, unit: string, file: string): string {
  return `${unitUnderstandingDir(app, module, unit)}/${file}`;
}

export function unitAsIsPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "as-is.md");
}

/** `<module>/<unit>` key form of the AS-IS path, for plans that carry the key in a token. */
export function unitKeyAsIsPath(app: string, unitKey: string): string {
  return `${unitsDir(app)}/${unitKey}/understanding/as-is.md`;
}

/** The unit's provenance record: digest, commit, run. Its presence on the default branch means "understood". */
export function unitUnderstandingPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "understanding.md");
}

export function unitRulesPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "rules.md");
}

export function unitDataObjectsPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "data-objects.md");
}

/** The unit's human rule verdicts, authored through a pull request. */
export function unitRulesReviewPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "rules-review.md");
}

export function unitFindingsPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "findings.md");
}

export function unitTopologyPath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "topology.md");
}

export function unitTracePath(app: string, module: string, unit: string): string {
  return unitUnderstandingFilePath(app, module, unit, "trace.md");
}

/** `<module>/<unit>` key form of a file of the unit's understanding folder. */
export function unitKeyUnderstandingPath(app: string, unitKey: string, file: string): string {
  return `${unitsDir(app)}/${unitKey}/understanding/${file}`;
}

export function unitTaskPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "task.md");
}

export function unitDesignPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "design.md");
}

export function unitReviewsDir(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "reviews");
}

export function unitGateReviewPath(app: string, module: string, unit: string, gate = "G4"): string {
  return `${unitReviewsDir(app, module, unit)}/${gate}.md`;
}

export function unitVerifyDir(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "verify");
}

export function unitGoldenDir(app: string, module: string, unit: string): string {
  return `${unitVerifyDir(app, module, unit)}/golden`;
}

export function unitRunsDir(app: string, module: string, unit: string): string {
  return `${unitVerifyDir(app, module, unit)}/runs`;
}

export function unitId(app: string, module: string, unit: string): string {
  return `${app}/${module}/${unit}`;
}

export function modernizationBriefPath(app: string): string {
  return `${applicationToBeDir(app)}/modernization-brief.md`;
}

/** Module-scoped authored notes live beside the module's units. */
export function transformationNotesPath(app: string, module: string): string {
  return `${unitModuleDir(app, module)}/TRANSFORMATION_NOTES.md`;
}

/** Application-level verification aggregate; per-unit evidence is under `verify/` (testing context, a later phase). */
export function verificationReportPath(app: string, extension: "md" | "json" = "md"): string {
  return generatedFilePath(app, `VERIFICATION.${extension}`);
}

/** Tokenised helpers for plans that run before the app and unit are known. */
export function goldenDir(module: string): string {
  return unitGoldenDir(DOCUMENT_PATH_TOKENS.app, module, DOCUMENT_PATH_TOKENS.unit);
}

export function runsDir(module: string, runId: string): string {
  return `${unitRunsDir(DOCUMENT_PATH_TOKENS.app, module, DOCUMENT_PATH_TOKENS.unit)}/${runId}`;
}

function unitKeyPath(unitKey: string, file: string): string {
  const [module = DOCUMENT_PATH_TOKENS.module, unit = DOCUMENT_PATH_TOKENS.unit] = unitKey.split("/");
  return unitFilePath(DOCUMENT_PATH_TOKENS.app, module, unit, file);
}

export function taskPackPath(unitKey: string): string {
  return unitKeyPath(unitKey, "task.md");
}

export function reviewsDir(unitKey: string): string {
  return unitKeyPath(unitKey, "reviews");
}
