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
 *   20-spaces/<space>/          team spaces of the wiki (ADR-0096): README.md is the space's home page, pages below it
 *     _templates/               the space's page templates
 *     _attachments/             files beside the pages of their folder (any folder of the wiki has one)
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
const SPACES_ROOT = "20-spaces";
const SCRATCH_ROOT = "scratch";
const PAGE_TEMPLATES_DIR = `${STANDARDS_ROOT}/page-templates`;
const SPACE_TEMPLATES = "_templates";
const ATTACHMENTS = "_attachments";
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

/** One unit-kind profile and its templates under a design set (ADR-0053). */
export function designProfileDir(set: string, kind: string): string {
  return `${designSetDir(set)}/${kind}`;
}

/** A template file of a set, named by the `Template` column of its files table; `<kind>/<name>` for a template of a profile (ADR-0053). */
export function designTemplatePath(set: string, template: string): string {
  return `${designSetDir(set)}/${template}`;
}

/** The profile of a set for one unit kind: its version, the files it adds or removes, its instructions (ADR-0053). */
export function designProfilePath(set: string, kind: string): string {
  return `${designProfileDir(set, kind)}/profile.md`;
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
// Wiki: team spaces, page ids, attachments (ADR-0096)
// ---------------------------------------------------------------------------

/** The scope of page ids: an uppercase short name of a space, written in its home page's `key` (2 to 10 characters). */
const PAGE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
/** The number is what `pageId` writes: from 1, padded to four digits, no leading zero beyond that. */
const PAGE_ID_PATTERN = /^PAGE-([A-Z][A-Z0-9]{1,9})-((?!0000$)[0-9]{4}|[1-9][0-9]{4,8})$/;
const PAGE_NUMBER_MAX = 999_999_999;
const ATTACHMENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The file types a page may keep in its `_attachments/` folder (ADR-0096 decision 6); SVG waits for its sanitiser. */
export const ATTACHMENT_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "webp", "pdf"];

/**
 * What no wiki or Brain reader treats as a page: roots that hold member plugins and run scratch, and folders that
 * hold restricted records and allocation ledgers (ADR-0075). Hidden folders are excluded too, by their name.
 */
export const DOCUMENT_EXCLUDED_ROOTS: readonly string[] = ["plugins", SCRATCH_ROOT];
export const DOCUMENT_EXCLUDED_FOLDERS: readonly string[] = ["restricted", "identifiers"];

/** Whether every segment of a repository-relative folder path is plain: not empty, not `.`, `..` or hidden. */
function isPlainFolder(path: string): boolean {
  return path !== "" && !path.includes("\\") && path.split("/").every((segment) => segment !== "" && !segment.startsWith("."));
}

/**
 * Whether a folder segment path leaves the wiki's pages: it starts in an excluded root (a checkout on Windows or macOS
 * is case-insensitive, so `Plugins/` is `plugins/`), holds an excluded folder, or is `_generated/`.
 */
function isExcludedFolder(segments: readonly string[]): boolean {
  if (DOCUMENT_EXCLUDED_ROOTS.includes((segments[0] ?? "").toLowerCase())) return true;
  return segments.some((segment) => DOCUMENT_EXCLUDED_FOLDERS.includes(segment.toLowerCase()) || segment.toLowerCase() === GENERATED);
}

function requireSpace(space: string): string {
  if (!isUnitSegment(space)) throw new Error(`"${space}" cannot name a space`);
  return space;
}

export function spacesDir(): string {
  return SPACES_ROOT;
}

/** A team space is one folder under `20-spaces/`; `space` is a segment (`isUnitSegment`). */
export function spaceDir(space: string): string {
  return `${SPACES_ROOT}/${requireSpace(space)}`;
}

/** The space's home page: front matter `title` and `key`, then the text of the page. */
export function spaceHomePath(space: string): string {
  return `${spaceDir(space)}/${UNIT_CARD}`;
}

/** The page templates of one space (Markdown files with front matter `type: template`). */
export function spaceTemplatesDir(space: string): string {
  return `${spaceDir(space)}/${SPACE_TEMPLATES}`;
}

/** The page templates every space of the project may use. */
export function pageTemplatesDir(): string {
  return PAGE_TEMPLATES_DIR;
}

/** Whether `key` can scope page ids: uppercase letters and digits, a letter first, 2 to 10 characters. */
export function isPageKey(key: string): boolean {
  return PAGE_KEY_PATTERN.test(key);
}

/** The id of a page: `PAGE-<KEY>-<nnnn>`, the number counted from 1 and padded to four digits. */
export function pageId(key: string, number: number): string {
  if (!isPageKey(key)) throw new Error(`"${key}" cannot scope page ids`);
  if (!Number.isInteger(number) || number < 1 || number > PAGE_NUMBER_MAX) throw new Error(`${number} cannot number a page`);
  return `PAGE-${key}-${String(number).padStart(4, "0")}`;
}

export function isPageId(id: string): boolean {
  return PAGE_ID_PATTERN.test(id);
}

/** The key and number of a page id, or undefined for anything else. */
export function parsePageId(id: string): { key: string; number: number } | undefined {
  const match = PAGE_ID_PATTERN.exec(id);
  return match?.[1] !== undefined && match[2] !== undefined ? { key: match[1], number: Number(match[2]) } : undefined;
}

/** The folder a page file sits in, which also holds its `_attachments/` folder; "" for a file at the root. */
export function pageFolder(pagePath: string): string {
  const slash = pagePath.lastIndexOf("/");
  return slash < 0 ? "" : pagePath.slice(0, slash);
}

/** Whether `file` is one safe file name: a letter or digit first, then letters, digits, `.`, `_` and `-`. */
export function isAttachmentName(file: string): boolean {
  return ATTACHMENT_NAME_PATTERN.test(file);
}

/** Whether `file` has the extension of an allowed attachment type, in any letter case. */
export function isAttachmentType(file: string): boolean {
  const dot = file.lastIndexOf(".");
  return dot > 0 && ATTACHMENT_EXTENSIONS.includes(file.slice(dot + 1).toLowerCase());
}

/**
 * The folder of the files that belong to the pages of `pageDir` (files beside the page, ADR-0096 decision 6). Callers
 * pass the folder of a page (`pageFolder`), which is a plain folder of the wiki: never an `_attachments/` folder, and
 * never under an excluded root or folder.
 */
export function pageAttachmentsDir(pageDir: string): string {
  if (!isPlainFolder(pageDir) || isExcludedFolder(pageDir.split("/")) || pageDir.split("/").includes(ATTACHMENTS)) {
    throw new Error(`"${pageDir}" cannot hold attachments`);
  }
  return `${pageDir}/${ATTACHMENTS}`;
}

export function pageAttachmentPath(pageDir: string, file: string): string {
  if (!isAttachmentName(file)) throw new Error(`"${file}" cannot name an attachment`);
  return `${pageAttachmentsDir(pageDir)}/${file}`;
}

/**
 * Whether a stage writes the document: the legacy and modern halves of an application and its read models. The wiki
 * shows them and people correct them through pull requests (ADR-0096 decision 2).
 */
export function isStageWrittenPath(path: string): boolean {
  const [root, app, half, ...rest] = path.split("/");
  return root === APPLICATIONS_ROOT && app !== undefined && isUnitSegment(app) && (half === LEGACY || half === MODERN || half === GENERATED) && rest.length > 0;
}

/**
 * Whether the wiki editor may write the path: a Markdown page, or an attachment of an allowed type in an
 * `_attachments/` folder; every segment plain (no empty, `.`, `..` or hidden one); outside member plugins, scratch,
 * restricted records, identifier ledgers and `_generated/`; not written by a stage. `kintsugi.yaml` is neither a
 * page nor an attachment, so it is never editable here.
 */
export function isWikiEditablePath(path: string): boolean {
  const segments = path.split("/");
  const file = segments[segments.length - 1] ?? "";
  const attachment = segments.length > 1 && segments[segments.length - 2] === ATTACHMENTS && isAttachmentName(file) && isAttachmentType(file);
  if (!attachment && !path.toLowerCase().endsWith(".md")) return false;
  if (path.includes("\\") || segments.some((segment) => segment === "" || segment.startsWith("."))) return false;
  if (isExcludedFolder(segments)) return false;
  return !isStageWrittenPath(path);
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

/** Read-only previous design retained before new skeletons overlay the inputs; never published. */
export function designPreviousPath(app: string, unitKey: string, set: string, file: string): string {
  return designRunFilePath(app, `previous/${unitKey === "@app" ? "_application" : unitKey}/${set}/${file}`);
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

/** The units of a design run in dependency order and the clusters of units that share interfaces (intermediate). */
export function designMapPath(app: string): string {
  return designRunFilePath(app, "map.json");
}

/** The contract reviewer's note on one cluster of units of a design run (intermediate). */
export function designContractPath(app: string, cluster: string): string {
  return designRunFilePath(app, `contract/${cluster}.md`);
}

/** The rounds of the verify loop of a design run: open findings per round (intermediate). */
export function designProgressPath(app: string): string {
  return designRunFilePath(app, "progress.json");
}

/** The requirements no design item of the set refers to, after `check_coverage.py` (intermediate). */
export function designCoveragePath(app: string): string {
  return designRunFilePath(app, "coverage.json");
}

/** The verify loop of a design run as the portal shows it: rounds, why it stopped, the status of each finding (intermediate, ADR-0083). */
export function designLoopPath(app: string): string {
  return designRunFilePath(app, "loop.json");
}

/** The review of the whole run, written for the pull request description (intermediate, ADR-0054). */
export function designSummaryPath(app: string): string {
  return designRunFilePath(app, "review.md");
}

/** Scratch of a review run (ADR-0071): the manifest, the files the merge request changes, the reviewer's notes. */
export function buildRunDir(app: string): string {
  return scratchFilePath(app, "build");
}

export function buildRunFilePath(app: string, file: string): string {
  return `${buildRunDir(app)}/${file}`;
}

/** What the prepare step found for each unit of the run and the merge request it reviews (intermediate). */
export function buildManifestPath(app: string): string {
  return buildRunFilePath(app, "manifest.json");
}

/** The files the merge request changes in the target repository, with their status (intermediate). */
export function buildChangesPath(app: string): string {
  return buildRunFilePath(app, "changes.json");
}

/** The reviewer's note on one unit of a review run (intermediate until the unit's review.md is written). */
export function buildReviewNotePath(app: string, unitKey: string): string {
  return buildRunFilePath(app, `review/${unitKey}.md`);
}

/** The findings of the reviewer's notes, per unit, after `check_code_review.py` (intermediate). */
export function buildReviewReportPath(app: string): string {
  return buildRunFilePath(app, "review-report.json");
}

/** The parity of the reviewed merge request with the units' rules (scratch, ADR-0088). */
export function buildParityPath(app: string): string {
  return buildRunFilePath(app, "parity.json");
}

/** The description of the pull request of a review run (intermediate). */
export function buildSummaryPath(app: string): string {
  return buildRunFilePath(app, "summary.md");
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

/** The record of the source lines the specification job of one unit was shown (intermediate, ADR-0086). */
export function understandReadsPath(app: string, unitKey: string): string {
  return understandRunFilePath(app, `reads/${unitKey}.json`);
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

/** Relative to the reference owner's document folder. */
export function identifierRegistryFile(kind: "rules" | "findings" | "gaps"): string {
  return `identifiers/${kind}-ids.md`;
}

/** Independent allocation history per unit and reference type (ADR-0075). */
export function unitIdentifierRegistryPath(app: string, module: string, unit: string, kind: "rules" | "findings" | "gaps"): string {
  return unitLegacyFilePath(app, module, unit, identifierRegistryFile(kind));
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

/** Evidence-bound gate publication lives beside the unit's modern documents. */
export function unitGateReviewPath(app: string, module: string, unit: string, gate = "G4"): string {
  return unitModernFilePath(app, module, unit, "reviews/" + encodeURIComponent(gate) + ".md");
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

/** The folder of what the build stages leave for a unit (ADR-0071); the `_` keeps it apart from the project's design sets. */
export function unitKeyBuildDir(app: string, unitKey: string): string {
  return `${modernDir(app)}/${unitKey}/_build`;
}

/** The independent review of the unit's merge request: the findings with their severity. */
export function unitCodeReviewPath(app: string, unitKey: string): string {
  return `${unitKeyBuildDir(app, unitKey)}/review.md`;
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

// ---------------------------------------------------------------------------
// What a folder of the layout holds, in words (the Brain index, ADR-0091)
// ---------------------------------------------------------------------------

const ROOT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [PROJECT_ROOT]: "The project: charter, RACI, risks, AI strategy and policy, KPI baseline, glossary and portfolio.",
  [STANDARDS_ROOT]: "Standards: conventions, mappings, review rules and the design sets designs are written from.",
  [DESIGN_SETS_ROOT]: "Design sets: the templates and profiles each design is written from.",
  [ARCHITECTURE_ROOT]: "Architecture: the blueprint, the overall design, architecture decisions and the common components.",
  [`${ARCHITECTURE_ROOT}/adr`]: "Architecture decision records of the target system.",
  [`${ARCHITECTURE_ROOT}/common`]: "Common components shared by the applications, one document per COM id.",
  [TRANSITION_ROOT]: "Transition: coexistence of the old and new systems, data migration and shared data.",
  [APPLICATIONS_ROOT]: "The applications, each with its old system (01-legacy) and its new system (02-modern).",
  [PAGE_TEMPLATES_DIR]: "Page templates every space of the wiki may start a page from.",
  [SPACES_ROOT]: "Team spaces of the wiki: a folder per space, its home page in README.md.",
};

/**
 * What a folder of the document repo holds, from the layout alone, or undefined for a folder the layout does
 * not name. A summary for readers that have nothing better, such as a folder without a README.
 */
export function describeDocumentFolder(path: string): string | undefined {
  const known = ROOT_DESCRIPTIONS[path];
  if (known !== undefined) return known;
  const [space, below, ...deeper] = path.startsWith(`${SPACES_ROOT}/`) ? path.slice(SPACES_ROOT.length + 1).split("/") : [];
  if (space !== undefined) {
    if (!isUnitSegment(space)) return undefined;
    if (below === undefined) return `Space ${space} of the wiki: its home page and the pages below it.`;
    if (below === SPACE_TEMPLATES && deeper.length === 0) return `Page templates of space ${space}.`;
    return undefined;
  }
  const [root, app, half, module, unit, part, ...rest] = path.split("/");
  if (root !== APPLICATIONS_ROOT || app === undefined || !isUnitSegment(app)) return undefined;
  if (half === undefined) return `Application ${app}: what people attached, its old system, its new system and the read models.`;
  if (half === INPUTS) return module === undefined ? `What people attached to ${app}: intent, graphs, telemetry.` : undefined;
  if (half === GENERATED) return module === undefined ? `Read models of ${app} rebuilt after a merge: business rules, data objects, security findings, traceability.` : undefined;
  if (half !== LEGACY && half !== MODERN) return undefined;
  const legacy = half === LEGACY;
  if (module === undefined) {
    return legacy
      ? `The old system of ${app}: its assessment (inventory, topology), the item catalog, the plan and what is known about each unit.`
      : `The new system of ${app}: requirements, the application's design and each unit's card, design sets, task and review.`;
  }
  if (module === "_catalog" && unit === undefined) return `The item catalog of ${app}: its modules and the items of each.`;
  if (module === "_design" && unit === undefined) return `The design sets of ${app} as a whole.`;
  if (!isUnitSegment(module)) return undefined;
  if (unit === undefined) return `Module ${module} of the ${legacy ? "old" : "new"} system of ${app}.`;
  if (!isUnitSegment(unit)) return undefined;
  if (part === undefined) {
    return legacy
      ? `What is known about unit ${module}/${unit}: its specification, business rules, data objects, findings, topology and trace.`
      : `Unit ${module}/${unit} in the new system: its card, design sets, task and build review.`;
  }
  if (rest.length > 0) return undefined;
  if (legacy && part === "rules") return `The business rules of unit ${module}/${unit}, one document per rule.`;
  if (!legacy && part === "_build") return `What the build left for unit ${module}/${unit}: the independent review of its merge request.`;
  return undefined;
}
