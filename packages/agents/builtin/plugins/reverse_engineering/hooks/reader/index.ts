// The readers the portal and the API use (ADR-0027): pure parsers of the artifacts the stages
// write to the document repo. Built to `dist/reader` and exported as `@kintsugi/agents/reader`.

export { parseInventory, type Inventory, type InventoryBucket, type InventoryDirectory, type InventoryFile, type InventoryLanguage, type InventorySignals } from './inventory.js'
export { bulletsIn, cellText, columnOf, paragraphsIn, sectionMatching, sectionsOf, tablesIn, type Section, type Table } from './markdown.js'
export { parseTopology, type TopoDomainEdge, type TopoEdge, type TopoFlow, type TopoNode, type Topology } from './topology.js'
export { citationsIn, idOfTitle, needsReview, parseRules, type Citation, type Rule, type RuleSet } from './rules.js'
export {
  markDuplicates,
  nameSimilarity,
  parseDataObjects,
  ruleCatalog,
  type CatalogRule,
  type DataField,
  type DataObject,
  type RuleCatalog,
  type RuleStatus,
} from './catalog.js'
export {
  SEVERITIES,
  carryOverOf,
  findingsOfTable,
  parseSecurityFindings,
  patchSummary,
  severityOf,
  toolsNotRunOf,
  type CarryOverItem,
  type CarryOverVerdict,
  type Confidence,
  type Finding,
  type FindingStatus,
  type Scorecard,
  type SecurityReport,
  type Severity,
  type ToolNotRun,
} from './findings.js'
export {
  UNIT_SEGMENT,
  buildTraceability,
  leftOutTotal,
  parseTraceSummary,
  parseUnitTrace,
  type TraceDataStore,
  type TraceSummary,
  type TraceUnit,
  type Traceability,
  type UnitFacts,
  type UnitTrace,
} from './traceability.js'
export { GAP_IMPACTS, GAP_KINDS, countGaps, parseGaps, parseSpecGaps, type Gap, type GapCounts, type GapImpact, type GapKind, type GapReport } from './gaps.js'
export { frontmatterOf, parseWorkItem, type Frontmatter, type WorkItemSummary } from './work-item.js'
export { ITEM_ID, parseItemCatalog, type ItemCatalog, type ItemCatalogDependency, type ItemCatalogItem, type ItemCatalogModule, type ItemCatalogPart } from './item-catalog.js'
export { renderLedger, parseLedger } from './ledger.js'
export { parsePlan, type PlanBatch, type UnderstandPlan } from './plan.js'
export { cardsOf, countOf, documentOf, fieldList, fieldText, firstRecords, itemsOf, listOf, numberOf, recordsOf, textOf, uncode, type Card, type Document } from './document.js'
export {
  DESIGN_CHECKS,
  DESIGN_SEEDS,
  DESIGN_SETS_PREFIX,
  checkDesignDocument,
  designBaseFiles,
  designCoverage,
  designFilesFor,
  designIsStale,
  designReferences,
  designItemIds,
  designRefText,
  designTemplateOf,
  designTemplateRefOf,
  loadDesignSets,
  parseDesignProfile,
  parseDesignSet,
  parseDesignTemplate,
  ruleCardsOf,
  type DesignCheck,
  type DesignContext,
  type DesignFile,
  type DesignProblem,
  type DesignProblemCode,
  type DesignProfile,
  type DesignProfileSource,
  type DesignSection,
  type DesignSet,
  type DesignSetSource,
  type DesignTemplate,
  type DesignTemplateProblem,
  type DesignTemplateRef,
  type LoadedDesignProfile,
  type LoadedDesignSet,
  type ResolvedDesignFile,
} from './design.js'

export { gapIsResolved, inspectSpecGaps, answerSpecGap } from './gaps.js'
export { designInputBlockers, type DesignInputs } from './design-readiness.js'
