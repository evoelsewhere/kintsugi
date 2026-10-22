import { countOf, documentOf, itemsOf, recordsOf, textOf } from './document.js'
import type { ItemCatalogItem } from './item-catalog.js'
import { sectionsOf, tablesIn } from './markdown.js'
import { resolveDots } from './paths.js'

/**
 * Traceability (ADR-0033, ADR-0042). The unit is the aggregate: its `trace.md` in `01-legacy/<module>/<unit>/` (written by
 * `scripts/finish_items.py`) holds what the specification recorded about it - entry points, the rules and findings
 * it applies, its dependencies, data objects, files, and the requirements, pull requests and tests the later phases
 * add. The application's matrix (units, reverse indexes) is built from those documents and the catalog
 * (`buildTraceability`); the generated `traceability.md` keeps only the totals (`parseTraceSummary`) for the headlines.
 *
 * The files are written by a script from agent-written fragments, so every field is still read as optional and of
 * unknown shape: a list that is not a list is empty, never thrown on. Lists are capped so a hostile file cannot
 * grow the payload.
 */

export type TraceDataStore = { id: string; access: string[] }

export type TraceUnit = {
  /** `<app>/<module>/<unit>`. */
  id: string
  /** The catalog entry key relative to its application; a full unit id also includes the application id. */
  key: string
  module: string
  unit: string
  title: string
  kind?: string
  /** Lines of code; 0 when unknown. */
  loc: number
  entryPoint: boolean
  /** The specification's document-repo path; null when none was written in the run. */
  spec: string | null
  files: string[]
  dependsOn: string[]
  usedBy: string[]
  dataStores: TraceDataStore[]
  externalSystems: string[]
  rules: string[]
  findings: string[]
  dataObjects: string[]
  entryPoints: string[]
  /** Requirement ids the unit's specification recorded. */
  requirements: string[]
  /** Pull request references (ids or URLs) that carry the unit's changes. */
  pullRequests: string[]
  /** Test references that pin the unit's behaviour. */
  tests: string[]
  openQuestions: number
}

export type Traceability = {
  app: string
  /** Whether BUSINESS_RULES.md and SECURITY_FINDINGS.md were there when the matrix was merged. */
  inputs: { businessRules: boolean; securityFindings: boolean }
  units: TraceUnit[]
  /** Rule id → unit ids. */
  rules: Record<string, string[]>
  /** Finding id → unit ids. */
  findings: Record<string, string[]>
  /** Source file → unit ids. */
  files: Record<string, string[]>
  /** Requirement id → unit ids. */
  requirements: Record<string, string[]>
  /** Pull request reference → unit ids. */
  pullRequests: Record<string, string[]>
  /** Test reference → unit ids. */
  tests: Record<string, string[]>
  /** Data store id → unit ids. */
  dataStores: Record<string, string[]>
  unmappedRules: string[]
  unmappedFindings: string[]
  cycles: string[][]
  /** What failed a check and was left out, by reason (`unknown rule ids`, `files not in the source`, …). */
  notes: Record<string, number>
}

/** A unit or module name as the scripts write it: one kebab-case path segment. */
export const UNIT_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/

const MAX_LIST = 500
const MAX_INDEX = 20_000

/** A unit's `trace.md`. */
export type UnitTrace = {
  entryPoints: string[]
  rulesApplied: string[]
  findings: string[]
  dependencies: { target: string; kind: string; direction: 'outbound' | 'inbound' }[]
  dataObjects: string[]
  externalSystems: string[]
  files: string[]
  requirements: string[]
  pullRequests: string[]
  tests: string[]
  openQuestions: number
}

/** A repository-relative path without `..`, or undefined. */
const relativePath = (value: string): string | undefined => {
  const path = textOf(value, 500)
  if (path === undefined || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined
  const clean = resolveDots(path)
  return clean === '' || clean.startsWith('..') ? undefined : clean
}

/** Parses a unit's trace.md; null when the text has no trace sections. */
export function parseUnitTrace(text: string): UnitTrace | null {
  const { data, body } = documentOf(text)
  const sections = sectionsOf(body).filter(section => section.level === 2)

  if (sections.length === 0) return null

  const list = (title: string, max = MAX_LIST): string[] => itemsOf(sections.find(section => section.title === title)?.body ?? '').slice(0, max)
  const dependencies = recordsOf(tablesIn(sections.find(section => section.title === 'Dependencies')?.body ?? '')[0]).flatMap(row =>
    row.target ? [{ target: row.target, kind: row.kind || 'call', direction: row.direction === 'inbound' ? ('inbound' as const) : ('outbound' as const) }] : [],
  )

  return {
    entryPoints: list('Entry points'),
    rulesApplied: list('Rules applied'),
    findings: list('Findings'),
    dependencies: dependencies.slice(0, MAX_LIST),
    dataObjects: list('Data objects'),
    externalSystems: list('External systems'),
    files: list('Files', 2_000).flatMap(path => relativePath(path) ?? []),
    requirements: list('Requirements'),
    pullRequests: list('Pull requests'),
    tests: list('Tests'),
    openQuestions: countOf(data.openQuestions),
  }
}

/** The totals the generated `traceability.md` keeps in its front matter. */
export type TraceSummary = {
  app: string
  items: number
  units: number
  modules: number
  specified: number
  entryPoints: number
  rulesCovered: number
  findingsMapped: number
  files: number
  dataStores: number
  requirements: number
  openQuestions: number
  stale: number
  inputs: { businessRules: boolean; securityFindings: boolean }
}

/** Parses the generated traceability.md; null when the text has no totals. */
export function parseTraceSummary(text: string): TraceSummary | null {
  const { data } = documentOf(text)

  if (data.units === undefined) return null

  return {
    app: textOf(data.app) ?? '',
    items: countOf(data.items),
    units: countOf(data.units),
    modules: countOf(data.modules),
    specified: countOf(data.specified),
    entryPoints: countOf(data.entryPoints),
    rulesCovered: countOf(data.rulesCovered),
    findingsMapped: countOf(data.findingsMapped),
    files: countOf(data.files),
    dataStores: countOf(data.dataStores),
    requirements: countOf(data.requirements),
    openQuestions: countOf(data.openQuestions),
    stale: countOf(data.stale),
    inputs: { businessRules: data.businessRules === true, securityFindings: data.securityFindings === true },
  }
}

/** One understood unit as the matrix is built from it. */
export type UnitFacts = {
  item: ItemCatalogItem
  trace: UnitTrace | null
  /** The document-repo path of the unit's AS-IS specification. */
  spec: string
}

function reverseIndex(units: TraceUnit[], pick: (unit: TraceUnit) => string[]): Record<string, string[]> {
  const index: Record<string, string[]> = {}

  for (const unit of units) {
    for (const value of pick(unit)) {
      if (Object.keys(index).length >= MAX_INDEX && index[value] === undefined) break
      index[value] = [...(index[value] ?? []), unit.id]
    }
  }

  return index
}

/**
 * The matrix of the units that are understood, from their catalog items and trace documents. `known` are the ids
 * of the catalog's active items, which a dependency may name (default: the units given).
 */
export function buildTraceability(app: string, facts: readonly UnitFacts[], inputs: Traceability['inputs'], known: ReadonlySet<string> = new Set(facts.map(({ item }) => item.id))): Traceability {
  const units: TraceUnit[] = facts.map(({ item, trace, spec }) => {
    const [module = '', unit = ''] = item.id.split('/')
    const dependencies = trace?.dependencies ?? []
    const stores = new Map<string, Set<string>>()

    for (const dep of dependencies) {
      if (dep.target.startsWith('ds:')) stores.set(dep.target, (stores.get(dep.target) ?? new Set()).add(dep.kind))
    }

    return {
      id: `${app}/${item.id}`,
      key: item.id,
      module,
      unit,
      title: item.name,
      kind: item.kind,
      loc: item.loc,
      entryPoint: item.entryPoints.length > 0,
      spec,
      files: trace !== null && trace.files.length > 0 ? trace.files : item.files.slice(0, 2_000),
      dependsOn: dependencies.filter(dep => dep.direction !== 'inbound' && known.has(dep.target)).map(dep => `${app}/${dep.target}`),
      usedBy: dependencies.filter(dep => dep.direction === 'inbound' && known.has(dep.target)).map(dep => `${app}/${dep.target}`),
      dataStores: [...stores.entries()].map(([id, access]) => ({ id, access: [...access].sort() })),
      externalSystems: trace?.externalSystems ?? [],
      rules: trace?.rulesApplied ?? [],
      findings: trace?.findings ?? [],
      dataObjects: trace?.dataObjects ?? [],
      entryPoints: trace?.entryPoints ?? [],
      requirements: trace?.requirements ?? [],
      pullRequests: trace?.pullRequests ?? [],
      tests: trace?.tests ?? [],
      openQuestions: trace?.openQuestions ?? 0,
    }
  })

  return {
    app,
    inputs,
    units,
    rules: reverseIndex(units, unit => unit.rules),
    findings: reverseIndex(units, unit => unit.findings),
    files: reverseIndex(units, unit => unit.files),
    requirements: reverseIndex(units, unit => unit.requirements),
    pullRequests: reverseIndex(units, unit => unit.pullRequests),
    tests: reverseIndex(units, unit => unit.tests),
    dataStores: reverseIndex(units, unit => unit.dataStores.map(store => store.id)),
    unmappedRules: [],
    unmappedFindings: [],
    cycles: [],
    notes: {},
  }
}

/** The total of the "left out" counts. */
export const leftOutTotal = (matrix: Pick<Traceability, 'notes'>): number => Object.values(matrix.notes).reduce((sum, value) => sum + value, 0)
