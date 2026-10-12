import { cellText, columnOf, sectionsOf, tablesIn } from './markdown.js'
import { citationsIn, idOfTitle, parseRules, type Citation, type Rule } from './rules.js'

/**
 * The business rule catalog of the extract-rules stage: `rules_result.json` (the workflow's
 * structured result: confirmed, rejected and unverified rules, data objects, stats), joined with
 * the ids `BUSINESS_RULES.md` gives each rule, plus `DATA_OBJECTS.md` when the result is missing.
 * Every field of the agent-written files is treated as optional. Never throws.
 */

export type RuleStatus = 'confirmed' | 'refuted' | 'unverified'

export type CatalogRule = {
  id: string
  name: string
  category?: string
  priority: string
  confidence?: string
  status: RuleStatus
  /** The rule's own source, as written (`src/a.java:15-17`). */
  source?: string
  plainEnglish?: string
  given?: string
  when?: string
  then?: string
  and?: string
  parameters?: string
  edgeCases: string[]
  suspectedDefect?: string
  smeQuestion?: string
  rejectionReason?: string
  /** Every `file:line` the rule names; the first is its source. */
  citations: Citation[]
  /** Set on rules that look like another rule of the catalog (same source lines or near-identical name). */
  duplicateGroup?: number
}

export type DataField = { name: string; type?: string; note?: string }

export type DataObject = { name: string; source?: string; fields: DataField[]; consumedBy: string[] }

export type RuleCatalog = {
  rules: CatalogRule[]
  dataObjects: DataObject[]
  /** Numeric stats of the result (`confirmed`, `rejected`, `p0`, `needsSme`, …). */
  stats: Record<string, number>
  /** Phases the extraction skipped or cut short, as written. */
  skippedPhases: string[]
  /** Where the rules were read from. */
  source: 'result' | 'markdown' | 'none'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter((item): item is string => item !== undefined) : [])

/** Lower-cased words of a name, for matching a result rule to its card and spotting look-alikes. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9$.]+/g, ' ')
    .split(' ')
    .filter(word => word.length > 2 && !STOP.has(word))

const STOP = new Set(['the', 'and', 'for', 'are', 'its', 'with', 'when', 'than', 'that', 'this', 'into', 'from', 'only', 'one', 'is', 'of'])

const keyOf = (name: string): string => wordsOf(name.replace(/…$/, '')).join(' ')

function ruleOf(raw: Record<string, unknown>, status: RuleStatus): Omit<CatalogRule, 'id'> | null {
  const name = str(raw.name) ?? str(raw.title)

  if (name === undefined) {
    return null
  }

  const source = str(raw.source)
  const fields = {
    category: str(raw.category),
    confidence: str(raw.confidence),
    source,
    plainEnglish: str(raw.plainEnglish) ?? str(raw.statement),
    given: str(raw.given),
    when: str(raw.when),
    then: str(raw.then),
    and: str(raw.and),
    parameters: str(raw.parameters),
    suspectedDefect: str(raw.suspectedDefect),
    smeQuestion: str(raw.smeQuestion),
    rejectionReason: str(raw.rejectionReason),
  }

  return {
    name,
    priority: str(raw.priority)?.toUpperCase() ?? '',
    status,
    ...(Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<CatalogRule>),
    edgeCases: strings(raw.edgeCases),
    citations: citationsIn([source ?? '', str(raw.parameters) ?? ''].join(' ')),
  }
}

function dataObjectsOfResult(value: unknown): DataObject[] {
  const objects: DataObject[] = []

  for (const raw of Array.isArray(value) ? value : []) {
    const name = isRecord(raw) ? str(raw.name) : undefined

    if (!isRecord(raw) || name === undefined) continue

    const source = str(raw.source)

    objects.push({
      name,
      ...(source !== undefined && { source }),
      fields: (Array.isArray(raw.fields) ? raw.fields : []).filter(isRecord).flatMap(field => {
        const fieldName = str(field.name)
        const type = str(field.type)
        const note = str(field.note)

        return fieldName === undefined ? [] : [{ name: fieldName, ...(type !== undefined && { type }), ...(note !== undefined && { note }) }]
      }),
      consumedBy: strings(raw.consumedBy),
    })
  }

  return objects
}

/** DATA_OBJECTS.md: a `## <Object>` section per record with `Source:`, a field table and `Used by:`. */
export function parseDataObjects(text: string): DataObject[] {
  return sectionsOf(text)
    .filter(section => section.level === 2)
    .map(section => {
      const table = tablesIn(section.body)[0]
      const name = table === undefined ? -1 : columnOf(table, /field|name/i)
      const type = table === undefined ? -1 : columnOf(table, /type/i)
      const note = table === undefined ? -1 : columnOf(table, /note|description/i)
      const source = /^Source:\s*(.+)$/im.exec(section.body)?.[1]
      const usedBy = /^Used by:\s*(.+)$/im.exec(section.body)?.[1]

      return {
        name: section.title,
        ...(source !== undefined && { source: cellText(source).replace(/`/g, '') }),
        fields: (table?.rows ?? []).flatMap(row => {
          const fieldName = row[name < 0 ? 0 : name] ?? ''
          const fieldType = type < 0 ? '' : (row[type] ?? '')
          const fieldNote = note < 0 ? '' : (row[note] ?? '')

          return fieldName === '' ? [] : [{ name: fieldName, ...(fieldType !== '' && { type: fieldType }), ...(fieldNote !== '' && { note: fieldNote }) }]
        }),
        consumedBy: usedBy === undefined ? [] : usedBy.split(/,\s+(?=[A-Z])/).map(item => cellText(item)).filter(item => item !== ''),
      }
    })
}

const fromCard = (rule: Rule): CatalogRule => ({
  id: rule.id,
  name: rule.title,
  ...(rule.category !== undefined && { category: rule.category }),
  priority: rule.priority,
  ...(rule.confidence !== undefined && { confidence: rule.confidence }),
  status: 'confirmed',
  ...(rule.citations[0] !== undefined && { source: `${rule.citations[0].path}:${rule.citations[0].from}${rule.citations[0].to === rule.citations[0].from ? '' : `-${rule.citations[0].to}`}` }),
  ...(rule.statement !== '' && { plainEnglish: rule.statement }),
  ...(rule.given !== undefined && { given: rule.given }),
  ...(rule.when !== undefined && { when: rule.when }),
  ...(rule.then !== undefined && { then: rule.then }),
  edgeCases: rule.edgeCases,
  ...(rule.defect !== undefined && { suspectedDefect: rule.defect }),
  ...(rule.sme !== undefined && { smeQuestion: rule.sme }),
  citations: rule.citations,
})

/**
 * The catalog from rules_result.json (preferred: it is structured) and BUSINESS_RULES.md (for the
 * ids, or the whole catalog when there is no result), with DATA_OBJECTS.md as the data objects'
 * fallback. Look-alike rules are grouped (`duplicateGroup`).
 */
export function ruleCatalog(resultText: string | null, rulesText: string | null, dataObjectsText: string | null): RuleCatalog {
  let result: Record<string, unknown> | null = null

  if (resultText !== null) {
    try {
      const parsed: unknown = JSON.parse(resultText)

      result = isRecord(parsed) ? parsed : null
    } catch {
      result = null
    }
  }

  const cards = rulesText === null ? [] : parseRules(rulesText).rules
  const idByName = new Map<string, string>()

  for (const card of cards) {
    if (!idByName.has(keyOf(card.title))) idByName.set(keyOf(card.title), card.id)
  }

  let rules: CatalogRule[]
  let source: RuleCatalog['source']

  if (result !== null) {
    const used = new Set<string>()
    const lists: [unknown, RuleStatus][] = [
      [result.confirmedRules, 'confirmed'],
      [result.unverifiedRules, 'unverified'],
      [result.rejectedRules, 'refuted'],
    ]

    rules = lists.flatMap(([list, status]) =>
      (Array.isArray(list) ? list : []).filter(isRecord).flatMap(raw => {
        const rule = ruleOf(raw, status)

        if (rule === null) return []

        const base = str(raw.id) ?? (status === 'confirmed' ? idByName.get(keyOf(rule.name)) : undefined) ?? idOfTitle(rule.name)
        let id = base

        for (let copy = 2; used.has(id); copy++) id = `${base}-${copy}`
        used.add(id)

        return [{ id, ...rule }]
      }),
    )
    source = 'result'
  } else {
    rules = cards.map(fromCard)
    source = cards.length === 0 ? 'none' : 'markdown'
  }

  const stats: Record<string, number> = {}

  if (result !== null && isRecord(result.stats)) {
    for (const [key, value] of Object.entries(result.stats)) {
      if (typeof value === 'number' && Number.isFinite(value)) stats[key] = value
    }
  }

  const fromResult = result === null ? [] : dataObjectsOfResult(result.dataObjects)

  return {
    rules: markDuplicates(rules.sort(byId)),
    dataObjects: fromResult.length > 0 || dataObjectsText === null ? fromResult : parseDataObjects(dataObjectsText),
    stats,
    skippedPhases: result === null || !isRecord(result.stats) ? [] : strings(result.stats.skippedPhases),
    source,
  }
}

const byId = (a: CatalogRule, b: CatalogRule): number =>
  (a.status === b.status ? 0 : a.status === 'refuted' ? 1 : b.status === 'refuted' ? -1 : 0) || a.id.localeCompare(b.id, undefined, { numeric: true })

const overlaps = (a: Citation, b: Citation): boolean => a.base === b.base && a.from <= b.to && b.from <= a.to

/** Share of words two names have in common (Jaccard). */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(wordsOf(a))
  const right = new Set(wordsOf(b))

  if (left.size === 0 || right.size === 0) return 0

  const shared = [...left].filter(word => right.has(word)).length

  return shared / (left.size + right.size - shared)
}

/**
 * Groups confirmed rules that likely say the same thing: their sources overlap (same file, shared
 * lines) or their names are near-identical. Grouping is transitive; groups are numbered from 1.
 */
export function markDuplicates(rules: CatalogRule[]): CatalogRule[] {
  const candidates = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.status !== 'refuted')
  const parent = rules.map((_, index) => index)
  const find = (index: number): number => {
    let root = index

    while (parent[root] !== root) root = parent[root] ?? root

    return root
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]

      if (a === undefined || b === undefined) continue

      const sourceA = a.rule.citations[0]
      const sourceB = b.rule.citations[0]
      const sameLines = sourceA !== undefined && sourceB !== undefined && overlaps(sourceA, sourceB)
      const similar = nameSimilarity(a.rule.name, b.rule.name) >= 0.6

      if ((sameLines && (a.rule.category === b.rule.category || nameSimilarity(a.rule.name, b.rule.name) >= 0.3)) || similar) {
        parent[find(a.index)] = find(b.index)
      }
    }
  }

  const sizes = new Map<number, number>()

  for (const { index } of candidates) sizes.set(find(index), (sizes.get(find(index)) ?? 0) + 1)

  const numbers = new Map<number, number>()

  return rules.map((rule, index) => {
    const root = find(index)

    if (rule.status === 'refuted' || (sizes.get(root) ?? 0) < 2) return rule

    if (!numbers.has(root)) numbers.set(root, numbers.size + 1)

    return { ...rule, duplicateGroup: numbers.get(root) ?? 0 }
  })
}
