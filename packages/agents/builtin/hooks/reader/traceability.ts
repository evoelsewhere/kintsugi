import { resolveDots } from './paths.js'

/**
 * `knowledge/as-is/<app>/traceability.json` of the understand stage (merge_traceability.py, ADR-0031):
 * the units with what each one covers (files, rules, findings, dependencies, data stores), the
 * reverse indexes, what no unit covers, the dependency cycles and the "left out" counts.
 *
 * The file is written by a script from agent-written fragments, so every field is still read as
 * optional and of unknown shape: a unit without an id is dropped, a list that is not a list is
 * empty, never thrown on. Lists and units are capped so a hostile file cannot grow the payload.
 */

export type TraceDataStore = { id: string; access: string[] }

export type TraceUnit = {
  /** `<app>/<module>/<unit>`. */
  id: string
  /** `<module>/<unit>`: the unit's key under `knowledge/as-is/<app>/` and `units/<app>/`. */
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

const MAX_UNITS = 2_000
const MAX_LIST = 500
const MAX_INDEX = 20_000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, max = 300): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined)

const strings = (value: unknown, max = MAX_LIST): string[] =>
  Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim().slice(0, 300)] : [])).slice(0, max) : []

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** A repository-relative path without `..`, or undefined. */
const relativePath = (value: unknown): string | undefined => {
  const path = str(value, 500)
  if (path === undefined || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined
  const clean = resolveDots(path)
  return clean === '' || clean.startsWith('..') ? undefined : clean
}

function index(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isRecord(value)) return out
  for (const [key, units] of Object.entries(value).slice(0, MAX_INDEX)) out[key.slice(0, 300)] = strings(units)
  return out
}

function unitOf(raw: unknown): TraceUnit | undefined {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  if (id === undefined) return undefined
  const parts = id.split('/')
  const module = str(raw.module) ?? (parts.length >= 3 ? parts.at(-2) : undefined) ?? ''
  const unit = str(raw.unit) ?? parts.at(-1) ?? id
  const kind = str(raw.kind)
  const spec = relativePath(raw.spec)
  return {
    id,
    key: module === '' ? unit : `${module}/${unit}`,
    module,
    unit,
    title: str(raw.title) ?? unit,
    ...(kind === undefined ? {} : { kind }),
    loc: count(raw.loc),
    entryPoint: raw.entryPoint === true,
    spec: spec ?? null,
    files: strings(raw.files).flatMap(path => relativePath(path) ?? []),
    dependsOn: strings(raw.dependsOn),
    usedBy: strings(raw.usedBy),
    dataStores: (Array.isArray(raw.dataStores) ? raw.dataStores : []).slice(0, MAX_LIST).flatMap(store => {
      const storeId = isRecord(store) ? str(store.id) : undefined
      return storeId === undefined || !isRecord(store) ? [] : [{ id: storeId, access: strings(store.access, 10) }]
    }),
    externalSystems: strings(raw.externalSystems),
    rules: strings(raw.rules),
    findings: strings(raw.findings),
    dataObjects: strings(raw.dataObjects),
    entryPoints: strings(raw.entryPoints),
    openQuestions: count(raw.openQuestions),
  }
}

/** Parses traceability.json; null when the text is not a usable matrix (not JSON, or no `units` list). */
export function parseTraceability(text: string): Traceability | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.units)) return null

  const seen = new Set<string>()
  const units = raw.units.slice(0, MAX_UNITS).flatMap(entry => {
    const unit = unitOf(entry)
    if (unit === undefined || seen.has(unit.id)) return []
    seen.add(unit.id)
    return [unit]
  })
  const inputs = isRecord(raw.inputs) ? raw.inputs : {}
  const notes: Record<string, number> = {}
  if (isRecord(raw.notes)) for (const [reason, value] of Object.entries(raw.notes).slice(0, 50)) if (count(value) > 0) notes[reason.slice(0, 120)] = count(value)

  return {
    app: str(raw.app) ?? '',
    inputs: { businessRules: inputs.businessRules === true, securityFindings: inputs.securityFindings === true },
    units,
    rules: index(raw.rules),
    findings: index(raw.findings),
    files: index(raw.files),
    dataStores: index(raw.dataStores),
    unmappedRules: strings(raw.unmappedRules, MAX_INDEX),
    unmappedFindings: strings(raw.unmappedFindings, MAX_INDEX),
    cycles: (Array.isArray(raw.cycles) ? raw.cycles : []).slice(0, MAX_LIST).map(cycle => strings(cycle)).filter(cycle => cycle.length > 1),
    notes,
  }
}

/** The total of the "left out" counts. */
export const leftOutTotal = (matrix: Pick<Traceability, 'notes'>): number => Object.values(matrix.notes).reduce((sum, value) => sum + value, 0)
