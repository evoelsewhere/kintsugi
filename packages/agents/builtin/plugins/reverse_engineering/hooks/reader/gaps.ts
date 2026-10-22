import { uncode } from './document.js'
import { columnOf, sectionMatching, sectionsOf, tablesIn, type Table } from './markdown.js'

/**
 * The gaps of the legacy understanding (ADR-0057): the `## Gaps and questions` table every AS-IS specification ends
 * with, and the application's `_generated/GAPS.md` that `scripts/rebuild_aggregates.py` joins from them (one more
 * column, `Item`). `scripts/gaps_common.py` parses the same table; the shared fixtures in `scripts/tests/fixtures/gaps/`
 * keep the two equal. Never throws: a row that is not a gap row is skipped.
 */

export const GAP_KINDS = ['missing-source', 'unresolved', 'ambiguous', 'unverified'] as const

export const GAP_IMPACTS = ['blocking', 'risk', 'note'] as const

export type GapKind = (typeof GAP_KINDS)[number]

export type GapImpact = (typeof GAP_IMPACTS)[number]

export type Gap = {
  /** `GAP-<module>.<unit>-NN`. */
  id: string
  kind: GapKind
  impact: GapImpact
  question: string
  /** The first place the gap shows: `<repository id>/<path>:line`, or a rule or finding id. */
  where: string
  /** The catalog item (`<module>/<unit>`) the gap belongs to, when the table says (the application's view does). */
  item?: string
}

export type GapCounts = {
  total: number
  /** Distinct items that have a gap. */
  units: number
  byKind: Record<GapKind, number>
  byImpact: Record<GapImpact, number>
}

export type GapReport = {
  gaps: Gap[]
  counts: GapCounts
}

const GAP_ID = /^GAP-[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,}$/

const kindOf = (value: string): GapKind | undefined => GAP_KINDS.find(kind => kind === value)

const impactOf = (value: string): GapImpact | undefined => GAP_IMPACTS.find(impact => impact === value)

function gapsOfTable(table: Table, defaultItem?: string): Gap[] {
  const column = (pattern: RegExp): number => columnOf(table, pattern)
  const [id, kind, impact, question, where, item] = [column(/^id$/i), column(/^kind$/i), column(/^impact$/i), column(/^question$/i), column(/^where$/i), column(/^item$/i)]

  if (id < 0 || kind < 0 || impact < 0) {
    return []
  }

  const cell = (row: readonly string[], index: number): string => (index < 0 ? '' : (row[index] ?? ''))
  const seen = new Set<string>()
  const gaps: Gap[] = []

  for (const row of table.rows) {
    const ident = uncode(cell(row, id)).trim()
    const found = kindOf(cell(row, kind).trim())
    const level = impactOf(cell(row, impact).trim())

    if (!GAP_ID.test(ident) || seen.has(ident) || found === undefined || level === undefined) {
      continue
    }

    seen.add(ident)

    const owner = item >= 0 ? uncode(cell(row, item)).trim() : (defaultItem ?? '')

    gaps.push({ id: ident, kind: found, impact: level, question: cell(row, question), where: uncode(cell(row, where)), ...(owner === '' ? {} : { item: owner }) })
  }

  return gaps
}

/** The gaps a specification lists; null when it has no `Gaps and questions` section (older documents). */
export function parseSpecGaps(markdown: string, item?: string): Gap[] | null {
  const section = sectionMatching(sectionsOf(markdown), /^gaps and questions$/i)

  if (section === undefined) {
    return null
  }

  return tablesIn(section.body).flatMap(table => gapsOfTable(table, item))
}

export const countGaps = (gaps: readonly Gap[]): GapCounts => ({
  total: gaps.length,
  units: new Set(gaps.flatMap(gap => (gap.item === undefined ? [] : [gap.item]))).size,
  byKind: Object.fromEntries(GAP_KINDS.map(kind => [kind, gaps.filter(gap => gap.kind === kind).length])) as Record<GapKind, number>,
  byImpact: Object.fromEntries(GAP_IMPACTS.map(impact => [impact, gaps.filter(gap => gap.impact === impact).length])) as Record<GapImpact, number>,
})

/** The application's `GAPS.md`: every table with the gap columns, each row with its `Item`. */
export function parseGaps(markdown: string): GapReport {
  const gaps = tablesIn(markdown).flatMap(table => gapsOfTable(table))

  return { gaps, counts: countGaps(gaps) }
}
