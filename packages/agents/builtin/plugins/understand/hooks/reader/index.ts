// The readers the portal and the API use (ADR-0027): pure parsers of the artifacts the stages
// write to the document repo. Built to `dist/reader` and exported as `@kintsugi/agents/reader`.

export { parseInventory, type Inventory, type InventoryFile, type InventoryLanguage } from './inventory.js'
export { bulletsIn, cellText, columnOf, paragraphsIn, sectionMatching, sectionsOf, tablesIn, type Section, type Table } from './markdown.js'
export { parseTopology, type TopoEdge, type TopoFlow, type TopoNode, type Topology } from './topology.js'
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
export { UNIT_SEGMENT, leftOutTotal, parseTraceability, type TraceDataStore, type TraceUnit, type Traceability } from './traceability.js'
export { frontmatterOf, parseWorkItem, type Frontmatter, type WorkItemSummary } from './work-item.js'
export { ITEM_ID, parseItemCatalog, type ItemCatalog, type ItemCatalogItem, type ItemCatalogModule, type ItemCatalogPart } from './item-catalog.js'
