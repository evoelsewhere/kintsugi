import { DEFAULT_GAP_SETTLER, GAP_SETTLERS, gapIsResolved, isGapSettler, isMeaningfulGapText as meaningful, type GapSettler, type GapStatus } from '@kintsugi/domain'
import { uncode } from './document.js'
import { columnOf, sectionMatching, sectionsOf, tablesIn, tableRangesIn, type Table } from './markdown.js'

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
  /** `GAP-<scope>-0001` (legacy IDs also read). */
  id: string
  kind: GapKind
  impact: GapImpact
  question: string
  /** The first place the gap shows: `<repository id>/<path>:line`, or a rule or finding id. */
  where: string
  /** Missing on older rows, which remain open. A resolution is effective only with answer and evidence. */
  status?: GapStatus
  answer?: string
  evidence?: string
  /** The catalog item (`<module>/<unit>`) the gap belongs to, when the table says (the application's view does). */
  item?: string
  /** Who or what can settle it (ADR-0087): the row's `Settled by`, or its kind's default when the row names none. */
  settledBy: GapSettler
  /** The concrete step that would settle it, when the row says (`Probe`). */
  probe?: string
}

export type GapCounts = {
  total: number
  open: number
  resolved: number
  /** Distinct items that have a gap. */
  units: number
  byKind: Record<GapKind, number>
  byImpact: Record<GapImpact, number>
  /** Open gaps by who or what can settle them. */
  bySettler: Record<GapSettler, number>
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

    const status = cell(row, column(/^status$/i)).trim()
    const answer = cell(row, column(/^answer$/i)).trim()
    const evidence = cell(row, column(/^evidence$/i)).trim()
    const settler = cell(row, column(/^settled by$/i)).trim()
    const probe = cell(row, column(/^probe$/i)).trim()
    gaps.push({ id: ident, kind: found, impact: level, question: cell(row, question), where: uncode(cell(row, where)), ...(owner === '' ? {} : { item: owner }),
      ...(status === 'resolved' || status === 'open' ? { status } : {}), ...(answer === '' ? {} : { answer }), ...(evidence === '' ? {} : { evidence }),
      settledBy: isGapSettler(settler) ? settler : DEFAULT_GAP_SETTLER[found], ...(probe === '' ? {} : { probe }) })
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
  open: gaps.filter(gap => !gapIsResolved(gap)).length,
  resolved: gaps.filter(gapIsResolved).length,
  units: new Set(gaps.flatMap(gap => (gap.item === undefined ? [] : [gap.item]))).size,
  byKind: Object.fromEntries(GAP_KINDS.map(kind => [kind, gaps.filter(gap => gap.kind === kind).length])) as Record<GapKind, number>,
  byImpact: Object.fromEntries(GAP_IMPACTS.map(impact => [impact, gaps.filter(gap => gap.impact === impact).length])) as Record<GapImpact, number>,
  bySettler: Object.fromEntries(GAP_SETTLERS.map(settler => [settler, gaps.filter(gap => gap.settledBy === settler && !gapIsResolved(gap)).length])) as Record<GapSettler, number>,
})

export { gapIsResolved }

/** Strict preflight/writer check; the tolerant display parser above remains backwards compatible. */
export function inspectSpecGaps(markdown: string): { gaps: Gap[]; problems: string[] } {
  const sections = sectionsOf(markdown).filter(section => section.level === 2 && /^gaps and questions$/i.test(section.title))
  const gaps = parseSpecGaps(markdown) ?? []
  const problems: string[] = []
  if (sections.length !== 1) return { gaps, problems: ['Specification needs exactly one Gaps and questions section; run understand or repair the specification.'] }
  const body = sections[0]!.body
  const tables = tablesIn(body)
  const known = new Set(gaps.map(gap => gap.id))
  const dangling = [...new Set(markdown.match(/(?<![A-Za-z0-9._-])GAP-[A-Za-z0-9][A-Za-z0-9._-]*-[0-9]{2,}(?![A-Za-z0-9_-])/g) ?? [])].filter(id => !known.has(id))
  if (dangling.length > 0) problems.push(`Gap reference has no table row: ${dangling.join(', ')}`)
  if (tables.length === 0 && body.trim().toLowerCase() === 'none.') return { gaps, problems }
  const table = tables[0]
  if (tables.length !== 1 || table === undefined || !['id', 'kind', 'question', 'where', 'impact'].every(name => table.header.some(header => header.toLowerCase() === name))) {
    return { gaps, problems: ['Gaps table needs ID, Kind, Question, Where and Impact columns.'] }
  }
  if (new Set(table.header.map(header => header.toLowerCase())).size !== table.header.length) problems.push('Gaps table has duplicate columns.')
  const seen = new Set<string>()
  for (const row of table.rows) {
    const cell = (name: string): string => (row[columnOf(table, new RegExp(`^${name}$`, 'i'))] ?? '').trim()
    const id = uncode(cell('id'))
    if (!GAP_ID.test(id) || seen.has(id)) problems.push(`Invalid or duplicate gap ID: ${id}`)
    seen.add(id)
    if (kindOf(cell('kind')) === undefined || impactOf(cell('impact')) === undefined || !cell('question') || !cell('where')) problems.push(`${id}: invalid kind, impact, question or evidence location`)
    const status = cell('status')
    if (status !== '' && status !== 'open' && status !== 'resolved') problems.push(`${id}: status must be open or resolved`)
    if (status === 'resolved' && (!meaningful(cell('answer')) || !meaningful(cell('evidence')))) problems.push(`${id}: a resolution needs an answer and evidence`)
    if (row.length !== table.header.length) problems.push(`${id}: gap row has the wrong number of columns`)
  }
  return { gaps, problems }
}

/** Update just the named table row in the specification; no answer document and no changes to other sections. */
export function answerSpecGap(markdown: string, id: string, answer: string, evidence: string, status: GapStatus): string {
  const checked = inspectSpecGaps(markdown)
  if (checked.problems.length > 0) throw new Error(checked.problems.join('; '))
  if (!checked.gaps.some(gap => gap.id === id)) throw new Error(`Gap ${id} is not in this specification`)
// eslint-disable-next-line no-control-regex -- answers must not contain line breaks or control characters
  if (!meaningful(answer) || !meaningful(evidence) || /[\r\n\u0000-\u001f\u007f]/.test(answer + evidence)) throw new Error('Answer and evidence must be meaningful single-line text')
  // Use source lines, not parsed cells, to preserve every other row, heading and paragraph verbatim.
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(newline)
  const section = sectionsOf(markdown).find(entry => entry.level === 2 && /^gaps and questions$/i.test(entry.title))!
  const range = tableRangesIn(section.body)[0]!
  const start = section.line + 1 + range.line
  const table = range.table
  const headers = [...table.header]
  const added = ['Status', 'Answer', 'Evidence'].filter(name => columnOf(table, new RegExp(`^${name}$`, 'i')) < 0)
  headers.push(...added)
  const suffix = (values: string[]): string => values.map(value => ` ${value} |`).join('')
  const extend = (line: string, values: string[]): string => line.replace(/\s*$/, '').replace(/\|?$/, '|') + suffix(values)
  if (added.length > 0) {
    lines[start] = extend(lines[start]!, added)
    lines[start + 1] = extend(lines[start + 1]!, added.map(() => '---'))
  }
  const safe = (value: string): string => value.replace(/\|/g, '\\|')
  table.rows.forEach((row, index) => {
    const line = start + 2 + index
    if (uncode(row[columnOf(table, /^id$/i)] ?? '').trim() !== id) {
      if (added.length > 0) lines[line] = extend(lines[line]!, added.map(() => ''))
      return
    }
    const cells = [...row, ...added.map(() => '')]
    for (const [name, value] of [['status', status], ['answer', answer], ['evidence', evidence]]) cells[headers.findIndex(header => header.toLowerCase() === name)] = value!
    lines[line] = `| ${cells.map(safe).join(' | ')} |`
  })
  return lines.join(newline)
}

/** The application's `GAPS.md`: every table with the gap columns, each row with its `Item`. */
export function parseGaps(markdown: string): GapReport {
  const gaps = tablesIn(markdown).flatMap(table => gapsOfTable(table))

  return { gaps, counts: countGaps(gaps) }
}
