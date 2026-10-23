/**
 * The document-repo path layout (ADR-0051; it replaces the tree of ADR-0042). Keep path construction
 * here so callers never encode the layout themselves.
 *
 *   00-project/                 charter, RACI, AI strategy and policy, KPI baseline, glossary, portfolio/
 *   01-standards/               conventions/, mappings/, review-rules.md, templates/<set>/ (the design sets)
 *   02-architecture/            the blueprint, adr/ and common/<COM-id>.md components
 *   03-transition/              coexistence, data migration, shared-data/
 *   10-applications/<app>/
 *     00-inputs/                what people attach
 *     01-legacy/                the old system: the assessment (inventory, topology, _catalog/, plan.md)
 *       <module>/<unit>/        what is known about a unit (spec.md, rules, findings, trace…)
 *     02-modern/                the new system: requirements.md, _design/<set>/ (the application's design)
 *       <module>/<unit>/        the unit's card (README.md), one folder per design set, task.md
 *     _generated/               read models rebuilt after a merge
 *   plugins/                    project-authored member plugins
 *   scratch/<app>/              job-to-job data of one run; outside the layout, never committed
 *
 * Both halves of an application use the same `<module>/<unit>` path. A folder whose name starts with
 * `_` is never a module: module and unit segments start with a letter or a digit.
 *
 * The document repo holds no JSON: committed files are Markdown (docs/reference/document-formats.md).
 */
const PROJECT_ROOT = "00-project";
const STANDARDS_ROOT = "01-standards";
const ARCHITECTURE_ROOT = "02-architecture";
const TRANSITION_ROOT = "03-transition";
const APPLICATIONS_ROOT = "10-applications";
const SCRATCH_ROOT = "scratch";
const DESIGN_SETS_ROOT = `${STANDARDS_ROOT}/templates`;
const INPUTS = "00-inputs";
const LEGACY = "01-legacy";
const MODERN = "02-modern";
const GENERATED = "_generated";
const UNIT_CARD = "README.md";
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const DOCUMENT_PATH_TOKENS = {
  app: "{app}",
  module: "{module}",
  unit: "{unit}",
  item: "{item}",
  run: "{run}",
} as const;

/** Paths committed straight to the default branch by kintsugi-bot (ADR-0019, ADR-0051). */
export const DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS: readonly string[] = [
  `${APPLICATIONS_ROOT}/*/${MODERN}/*/*/${UNIT_CARD}`,
  `${APPLICATIONS_ROOT}/*/${MODERN}/*/*/task.md`,
  `${APPLICATIONS_ROOT}/*/${GENERATED}/**`,
  // The AI plan for what to understand next: advice, replaced by every planning run.
  `${APPLICATIONS_ROOT}/*/${LEGACY}/plan.md`,
];

/** Whether a folder name can be a module or a unit (folders starting with `_` belong to the application). */
export function isUnitSegment(name: string): boolean {
  return SEGMENT_PATTERN.test(name);
}

// ---------------------------------------------------------------------------
// Project level
// ---------------------------------------------------------------------------

export function projectDir(): string {
  return PROJECT_ROOT;
}

/** The project's glossary: one row per term, a column per language. */
export function glossaryPath(): string {
  return `${PROJECT_ROOT}/glossary.md`;
}

export function standardsDir(): string {
  return STANDARDS_ROOT;
}

/** The project's specification profiles by item kind (ADR-0060): `<kind>.md` files. */
export function specificationProfilesDir(): string {
  return `${STANDARDS_ROOT}/specifications`;
}

export function transitionDir(): string {
  return TRANSITION_ROOT;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export function applicationsDir(): string {
  return APPLICATIONS_ROOT;
}

export function applicationDir(app: string): string {
  return `${applicationsDir()}/${app}`;
}

export function applicationInputsDir(app: string): string {
  return `${applicationDir(app)}/${INPUTS}`;
}

export function applicationInputPath(app: string, file: string): string {
  return `${applicationInputsDir(app)}/${file}`;
}

/** The old system's half of an application: the assessment at its top, a folder per understood unit. */
export function legacyDir(app: string): string {
  return `${applicationDir(app)}/${LEGACY}`;
}

/** The new system's half of an application: requirements, the application's design, a folder per unit. */
export function modernDir(app: string): string {
  return `${applicationDir(app)}/${MODERN}`;
}

export function applicationRequirementsPath(app: string): string {
  return `${modernDir(app)}/requirements.md`;
}

/** The application's own design, written with the common design (ADR-0044): its components, interfaces and data ownership. */
export function applicationDesignPath(app: string): string {
  return `${modernDir(app)}/design.md`;
}

// ---------------------------------------------------------------------------
// Assessment context: the top of the legacy half
// ---------------------------------------------------------------------------

export function assessmentDir(app: string): string {
  return legacyDir(app);
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

/** The synthesis of the assessment, written by the assess stage's last job. */
export function assessmentSynthesisPath(app: string): string {
  return assessmentFilePath(app, "assessment.md");
}

/** The domain diagram of the synthesis, one Mermaid flowchart. */
export function assessmentDiagramPath(app: string): string {
  return assessmentFilePath(app, "architecture.mmd");
}

export function assessmentCatalogDir(app: string): string {
  return assessmentFilePath(app, "_catalog");
}

/** The catalog's index: its modules and items, one table row each. */
export function assessmentCatalogPath(app: string): string {
  return `${assessmentCatalogDir(app)}/index.md`;
}

/** One module's items, one section each: summary, files, dependencies. */
export function assessmentCatalogModulePath(app: string, module: string): string {
  return `${assessmentCatalogDir(app)}/${module}.md`;
}

/** The notes of the assessment's analysis jobs (structure, debt, security). */
export function assessmentAnalysisDir(app: string): string {
  return assessmentFilePath(app, "_analysis");
}

export function assessmentToolsDir(app: string): string {
  return assessmentFilePath(app, "_tools");
}

export function topologyExtractorPath(app: string): string {
  return `${assessmentToolsDir(app)}/extract_topology.py`;
}

// ---------------------------------------------------------------------------
// Understanding context, application level
// ---------------------------------------------------------------------------

/** The checked plan of what to understand next, batch by batch (auto-committed advice). */
export function understandPlanPath(app: string): string {
  return `${legacyDir(app)}/plan.md`;
}

// ---------------------------------------------------------------------------
// Design context (ADR-0044, ADR-0045, ADR-0050)
// ---------------------------------------------------------------------------

/** The project-level architecture folder: the blueprint, the ADRs and the common components. */
export function architectureDir(): string {
  return ARCHITECTURE_ROOT;
}

export function commonComponentsDir(): string {
  return `${ARCHITECTURE_ROOT}/common`;
}

/** One common component, written by the foundation team; `id` is its `COM-…` id. */
export function commonComponentPath(id: string): string {
  return `${commonComponentsDir()}/${id}.md`;
}

/** Where a project defines its design sets: one folder per set. */
export function designSetsDir(): string {
  return DESIGN_SETS_ROOT;
}

export function designSetDir(set: string): string {
  return `${designSetsDir()}/${set}`;
}

/** The definition of a set: front matter for its identity, a table of its files. */
export function designSetPath(set: string): string {
  return `${designSetDir(set)}/set.md`;
}

/** A template file of a set, named by the `Template` column of its files table; `<kind>/<name>` for a template of a profile (ADR-0053). */
export function designTemplatePath(set: string, template: string): string {
  return `${designSetDir(set)}/${template}`;
}

/** The profile of a set for one unit kind: its version, the files it adds or removes, its instructions (ADR-0053). */
export function designProfilePath(set: string, kind: string): string {
  return `${designSetDir(set)}/${kind}/profile.md`;
}

/** The design of the application as a whole, one folder per design set of scope `application` (ADR-0050). */
export function applicationDesignDir(app: string): string {
  return `${modernDir(app)}/_design`;
}

export function applicationDesignSetDir(app: string, set: string): string {
  return `${applicationDesignDir(app)}/${set}`;
}

/** A design document of the application; `file` is the `Path` of the set's files table. */
export function applicationDesignFilePath(app: string, set: string, file: string): string {
  return `${applicationDesignSetDir(app, set)}/${file}`;
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

/** Scratch of a design run (ADR-0049): the scaffold manifest and the check report. */
export function designRunDir(app: string): string {
  return scratchFilePath(app, "design");
}

export function designRunFilePath(app: string, file: string): string {
  return `${designRunDir(app)}/${file}`;
}

/** What the scaffold step wrote for each unit of the run (intermediate). */
export function designManifestPath(app: string): string {
  return designRunFilePath(app, "manifest.json");
}

/** The conformance of each unit of the run after a check (intermediate). */
export function designReportPath(app: string): string {
  return designRunFilePath(app, "report.json");
}

/** The reviewer's note on one unit of a design run (ADR-0054, intermediate); the application is `_application`. */
export function designReviewPath(app: string, unitKey: string): string {
  return designRunFilePath(app, `review/${unitKey === "@app" ? "_application" : unitKey}.md`);
}

/** The findings of the reviewer's notes, per unit, after `check_review.py` (intermediate). */
export function designReviewReportPath(app: string): string {
  return designRunFilePath(app, "review-report.json");
}

/** The review of the whole run, written for the pull request description (intermediate, ADR-0054). */
export function designSummaryPath(app: string): string {
  return designRunFilePath(app, "review.md");
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

/** Application aggregates rebuilt from authored unit documents, and the Overview run's documents. */
export function generatedDir(app: string): string {
  return `${applicationDir(app)}/${GENERATED}`;
}

export function generatedFilePath(app: string, file: string): string {
  return `${generatedDir(app)}/${file}`;
}

// ---------------------------------------------------------------------------
// Units: the same <module>/<unit> path in both halves
// ---------------------------------------------------------------------------

/**
 * Application id of a per-unit path (a file under `01-legacy/<module>/<unit>/` or `02-modern/<module>/<unit>/`),
 * if the path belongs to a unit of an application.
 */
export function appFromUnitPath(path: string): string | undefined {
  const [root, app, half, module, unit, ...rest] = path.split("/");
  if (root !== APPLICATIONS_ROOT || (half !== LEGACY && half !== MODERN) || rest.length === 0) return undefined;
  return app !== undefined && module !== undefined && unit !== undefined && isUnitSegment(app) && isUnitSegment(module) && isUnitSegment(unit) ? app : undefined;
}

export function legacyModuleDir(app: string, module: string): string {
  return `${legacyDir(app)}/${module}`;
}

export function modernModuleDir(app: string, module: string): string {
  return `${modernDir(app)}/${module}`;
}

/** What is known about the unit, written by the understanding context. */
export function unitLegacyDir(app: string, module: string, unit: string): string {
  return `${legacyModuleDir(app, module)}/${unit}`;
}

/** What is built for the unit: its card, its design and its task pack. */
export function unitModernDir(app: string, module: string, unit: string): string {
  return `${modernModuleDir(app, module)}/${unit}`;
}

export function unitLegacyFilePath(app: string, module: string, unit: string, file: string): string {
  return `${unitLegacyDir(app, module, unit)}/${file}`;
}

export function unitModernFilePath(app: string, module: string, unit: string, file: string): string {
  return `${unitModernDir(app, module, unit)}/${file}`;
}

/** The unit's card: its state (front matter) and what it is built from and into. */
export function unitStatePath(app: string, module: string, unit: string): string {
  return unitModernFilePath(app, module, unit, UNIT_CARD);
}

/** `<module>/<unit>` key form of the unit's card. */
export function unitKeyStatePath(app: string, unitKey: string): string {
  return `${modernDir(app)}/${unitKey}/${UNIT_CARD}`;
}

/** The AS-IS specification of the unit. */
export function unitAsIsPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "spec.md");
}

/** `<module>/<unit>` key form of the AS-IS path, for plans that carry the key in a token. */
export function unitKeyAsIsPath(app: string, unitKey: string): string {
  return unitKeyLegacyPath(app, unitKey, "spec.md");
}

/** The unit's provenance record: digest, commit, run. Its presence on the default branch means "understood". */
export function unitUnderstandingPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "understanding.md");
}

/** The unit's rules index: a table of its rules, each linking its own file under `unitRulesDir`. */
export function unitRulesPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "rules.md");
}

/** The folder of the unit's rule files, one `<rule id>.md` per rule. */
export function unitRulesDir(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "rules");
}

export function unitRuleFilePath(app: string, module: string, unit: string, ruleId: string): string {
  return `${unitRulesDir(app, module, unit)}/${ruleId}.md`;
}

export function unitDataObjectsPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "data-objects.md");
}

/** The unit's human rule verdicts, authored through a pull request. */
export function unitRulesReviewPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "rules-review.md");
}

export function unitFindingsPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "findings.md");
}

export function unitTopologyPath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "topology.md");
}

export function unitTracePath(app: string, module: string, unit: string): string {
  return unitLegacyFilePath(app, module, unit, "trace.md");
}

/** `<module>/<unit>` key form of a file of the unit's legacy folder. */
export function unitKeyLegacyPath(app: string, unitKey: string, file: string): string {
  return `${legacyDir(app)}/${unitKey}/${file}`;
}

export function unitTaskPath(app: string, module: string, unit: string): string {
  return unitModernFilePath(app, module, unit, "task.md");
}

/** The unit's documents of one design set the project defines. */
export function unitDesignSetDir(app: string, module: string, unit: string, set: string): string {
  return unitModernFilePath(app, module, unit, set);
}

/** `<module>/<unit>` key form of a design set's folder. */
export function unitKeyDesignSetDir(app: string, unitKey: string, set: string): string {
  return `${modernDir(app)}/${unitKey}/${set}`;
}

/** A design document of the unit; `file` is the `Path` of the set's files table. */
export function unitDesignFilePath(app: string, module: string, unit: string, set: string, file: string): string {
  return `${unitDesignSetDir(app, module, unit, set)}/${file}`;
}

export function unitId(app: string, module: string, unit: string): string {
  return `${app}/${module}/${unit}`;
}

/** Module-scoped authored notes live beside the module's units on the modern side. */
export function transformationNotesPath(app: string, module: string): string {
  return `${modernModuleDir(app, module)}/TRANSFORMATION_NOTES.md`;
}

/** The task pack of a unit, with the application left as a token. */
export function taskPackPath(unitKey: string): string {
  return `${modernDir(DOCUMENT_PATH_TOKENS.app)}/${unitKey}/task.md`;
}
