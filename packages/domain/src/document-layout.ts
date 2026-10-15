/**
 * The document-repo path layout (ADR-0038). Keep path construction here so callers can migrate
 * without independently encoding the layout.
 */
const APPLICATIONS_ROOT = "applications";
const APP_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const DOCUMENT_PATH_TOKENS = {
  app: "{app}",
  module: "{module}",
  unit: "{unit}",
  item: "{item}",
  run: "{run}",
} as const;

/** Paths committed straight to the default branch by kintsugi-bot (ADR-0019, ADR-0038). */
export const DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS: readonly string[] = [
  "applications/*/units/**/unit.md",
  "applications/*/units/**/task.md",
  "applications/*/generated/**",
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

export function applicationAssessmentDir(app: string): string {
  return `${applicationDir(app)}/assessment`;
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

export function assessmentDir(app: string): string {
  return applicationAssessmentDir(app);
}

export function assessmentFilePath(app: string, file: string): string {
  return `${assessmentDir(app)}/${file}`;
}

export function assessmentInventoryPath(app: string): string {
  return assessmentFilePath(app, "inventory.json");
}

export function assessmentTopologyPath(app: string): string {
  return assessmentFilePath(app, "topology.json");
}

export function assessmentCatalogPath(app: string): string {
  return assessmentFilePath(app, "catalog.json");
}

export function assessmentAnalysisDir(app: string): string {
  return assessmentFilePath(app, "analysis");
}

export function assessmentCatalogDraftDir(app: string): string {
  return assessmentFilePath(app, "catalog-draft");
}

export function assessmentToolsDir(app: string): string {
  return assessmentFilePath(app, "tools");
}

export function topologyExtractorPath(app: string): string {
  return `${assessmentToolsDir(app)}/extract_topology.py`;
}

/** Compatibility name: unit documents now live with their subject, not under assessment. */
export function assessmentItemsDir(app: string): string {
  return unitsDir(app);
}

/** `itemId` is the catalog key `<module>/<unit>`. */
export function assessmentItemDir(app: string, itemId: string): string {
  return `${assessmentItemsDir(app)}/${itemId}`;
}

export function assessmentItemFilePath(app: string, itemId: string, file: string): string {
  return `${assessmentItemDir(app, itemId)}/${file}`;
}

/** Compatibility name for the per-unit AS-IS document. */
export function assessmentBriefsDir(app: string): string {
  return unitsDir(app);
}

export function assessmentBriefPath(app: string, unitKey: string): string {
  return `${assessmentBriefsDir(app)}/${unitKey}/as-is.md`;
}

/** Assessment artifacts produced during understanding are scoped to the application. */
export function understandRunDir(app: string): string {
  return assessmentDir(app);
}

export function understandRunFilePath(app: string, file: string): string {
  return `${understandRunDir(app)}/${file}`;
}

export function understandScopePath(app: string): string {
  return understandRunFilePath(app, "scope.json");
}

/** Application aggregates rebuilt from authored unit documents. */
export function generatedDir(app: string): string {
  return `${applicationDir(app)}/generated`;
}

export function generatedFilePath(app: string, file: string): string {
  return `${generatedDir(app)}/${file}`;
}

/** Compatibility paths retained for existing callers, now rooted in the subject-based unit tree. */
export function knowledgeAsIsDir(app: string): string {
  return unitsDir(app);
}

export function knowledgeAsIsItemsDir(app: string): string {
  return unitsDir(app);
}

/** Application id for one of the per-unit evidence paths, if the path belongs to an application. */
export function appFromUnitPath(path: string): string | undefined {
  const segments = path.split("/");
  const app =
    segments[0] === APPLICATIONS_ROOT && segments[2] === "units" && segments.length >= 5
      ? segments[1]
      : undefined;
  return app !== undefined && APP_SEGMENT_PATTERN.test(app) ? app : undefined;
}

/** Compatibility alias; catalog items correspond to per-unit directories. */
export function appFromItemPath(path: string): string | undefined {
  return appFromUnitPath(path);
}

export function knowledgeAsIsItemDir(app: string, itemId: string): string {
  return `${unitsDir(app)}/${itemId}`;
}

export function knowledgeAsIsItemFilePath(app: string, itemId: string, file: string): string {
  return `${knowledgeAsIsItemDir(app, itemId)}/${file}`;
}

/** Compatibility name for the per-unit AS-IS document. */
export function knowledgeAsIsUnitPath(app: string, unitId: string): string {
  return `${unitsDir(app)}/${unitId}/as-is.md`;
}

export function knowledgeAsIsGeneratedDir(app: string): string {
  return generatedDir(app);
}

export function knowledgeAsIsGeneratedFilePath(app: string, file: string): string {
  return generatedFilePath(app, file);
}

/** Legacy identity index read by assess to preserve ids during catalog reconciliation. */
export function legacyUnitsIndexPath(app: string): string {
  return assessmentFilePath(app, "units.json");
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

export function unitStatePath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "unit.md");
}

export function unitAsIsPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "as-is.md");
}

export function unitRulesPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "rules.json");
}

export function unitRulesReviewPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "rules-review.json");
}

export function unitFindingsPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "findings.json");
}

export function unitTopologyPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "topology.json");
}

export function unitTracePath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "trace.json");
}

export function unitMetaPath(app: string, module: string, unit: string): string {
  return unitFilePath(app, module, unit, "meta.json");
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
  return applicationInputPath(app, "INTENT.md");
}

/** Compatibility alias for the application-level TO-BE design. */
export function transformationNotesPath(app: string, _module: string): string {
  return applicationDesignPath(app);
}

/** Application-level verification aggregate; per-unit evidence is under `verify/`. */
export function verificationReportPath(app: string, extension: "md" | "json" = "md"): string {
  return generatedFilePath(app, `VERIFICATION.${extension}`);
}

/** Compatibility helpers use tokenized app/unit segments until callers supply full unit ids. */
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
