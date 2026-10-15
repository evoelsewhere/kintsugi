/**
 * The current document-repo path layout. Keep path construction here so callers can migrate
 * without independently encoding the layout. Phase C changes these functions to the new paths.
 */
const ASSESSMENT_ROOT = "assessment";
const KNOWLEDGE_ROOT = "knowledge";
const AS_IS_SEGMENT = "as-is";
const ITEMS_SEGMENT = "items";
const APP_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const DOCUMENT_PATH_TOKENS = {
  app: "{app}",
  module: "{module}",
  unit: "{unit}",
  item: "{item}",
  run: "{run}",
} as const;

/** Existing direct-commit defaults; moved here because these patterns are part of the layout. */
export const DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS: readonly string[] = [
  "units/**",
  "tasks/**",
  "knowledge/**/generated/**",
  "assessment/**/generated/**",
];

export function assessmentDir(app: string): string {
  return `${ASSESSMENT_ROOT}/${app}`;
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

export function assessmentItemsDir(app: string): string {
  return `${assessmentDir(app)}/${ITEMS_SEGMENT}`;
}

export function assessmentItemDir(app: string, itemId: string): string {
  return `${assessmentItemsDir(app)}/${itemId}`;
}

export function assessmentItemFilePath(app: string, itemId: string, file: string): string {
  return `${assessmentItemDir(app, itemId)}/${file}`;
}

export function assessmentBriefsDir(app: string): string {
  return assessmentFilePath(app, "understand/briefs");
}

export function assessmentBriefPath(app: string, unitKey: string): string {
  return `${assessmentBriefsDir(app)}/${unitKey}.json`;
}

export function understandRunDir(app: string): string {
  return assessmentFilePath(app, "understand");
}

export function understandRunFilePath(app: string, file: string): string {
  return `${understandRunDir(app)}/${file}`;
}

export function understandScopePath(app: string): string {
  return understandRunFilePath(app, "scope.json");
}

/** Application aggregates written by rebuild_aggregates.py. */
export function generatedDir(app: string): string {
  return assessmentFilePath(app, "generated");
}

export function generatedFilePath(app: string, file: string): string {
  return `${generatedDir(app)}/${file}`;
}

export function knowledgeAsIsDir(app: string): string {
  return `${KNOWLEDGE_ROOT}/${AS_IS_SEGMENT}/${app}`;
}

export function knowledgeAsIsItemsDir(app: string): string {
  return `${knowledgeAsIsDir(app)}/${ITEMS_SEGMENT}`;
}

/** Application id for one of the current per-item evidence paths, if the path belongs to an app. */
export function appFromItemPath(path: string): string | undefined {
  const segments = path.split("/");
  const app =
    segments[0] === ASSESSMENT_ROOT && segments[2] === ITEMS_SEGMENT && segments.length >= 4
      ? segments[1]
      : segments[0] === KNOWLEDGE_ROOT && segments[1] === AS_IS_SEGMENT && segments[3] === ITEMS_SEGMENT && segments.length >= 5
        ? segments[2]
        : undefined;
  return app !== undefined && APP_SEGMENT_PATTERN.test(app) ? app : undefined;
}

export function knowledgeAsIsItemDir(app: string, itemId: string): string {
  return `${knowledgeAsIsItemsDir(app)}/${itemId}`;
}

export function knowledgeAsIsItemFilePath(app: string, itemId: string, file: string): string {
  return `${knowledgeAsIsItemDir(app, itemId)}/${file}`;
}

export function knowledgeAsIsUnitPath(app: string, unitId: string): string {
  return `${knowledgeAsIsDir(app)}/${unitId}.md`;
}

export function knowledgeAsIsGeneratedDir(app: string): string {
  return `${knowledgeAsIsDir(app)}/generated`;
}

export function knowledgeAsIsGeneratedFilePath(app: string, file: string): string {
  return `${knowledgeAsIsGeneratedDir(app)}/${file}`;
}

/** Legacy identity index read by assess to preserve ids during catalog reconciliation. */
export function legacyUnitsIndexPath(app: string): string {
  return `${knowledgeAsIsDir(app)}/units.json`;
}

export function unitsDir(app: string): string {
  return `units/${app}`;
}

export function unitModuleDir(app: string, module: string): string {
  return `${unitsDir(app)}/${module}`;
}

export function unitDir(app: string, module: string, unit: string): string {
  return `${unitModuleDir(app, module)}/${unit}`;
}

export function unitStatePath(app: string, module: string, unit: string): string {
  return `${unitDir(app, module, unit)}.md`;
}

export function unitId(app: string, module: string, unit: string): string {
  return `${app}/${module}/${unit}`;
}

export function modernizationBriefPath(app: string): string {
  return assessmentFilePath(app, "MODERNIZATION_BRIEF.md");
}

export function transformationNotesPath(app: string, module: string): string {
  return assessmentFilePath(app, `modules/${module}/TRANSFORMATION_NOTES.md`);
}

export function verificationReportPath(app: string, extension: "md" | "json" = "md"): string {
  return assessmentFilePath(app, `VERIFICATION.${extension}`);
}

/** Current member verification paths use the module slug, without an application prefix. */
export function goldenDir(module: string): string {
  return `golden/${module}`;
}

export function runsDir(module: string, runId: string): string {
  return `runs/${module}/${runId}`;
}

export function taskPackPath(unitKey: string): string {
  return `tasks/${unitKey}.md`;
}

export function reviewsDir(unitKey: string): string {
  return `reviews/${unitKey}`;
}
