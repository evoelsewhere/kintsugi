import { cellText, columnOf, sectionsOf, tablesIn } from './markdown.js'
import { parseRules, type Citation, type Rule } from './rules.js'

/**
 * The business rule catalog: the rule cards of a rules document and the data objects document. Every field of the
 * agent-written files is treated as optional. Never throws.
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
  /** Where the rules were read from. */
  source: 'markdown' | 'none'
}

/** Lower-cased words of a name, for spotting look-alike rules. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9$.]+/g, ' ')
    .split(' ')
    .filter(word => word.length > 2 && !STOP.has(word))

const STOP = new Set(['the', 'and', 'for', 'are', 'its', 'with', 'when', 'than', 'that', 'this', 'into', 'from', 'only', 'one', 'is', 'of'])

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
 * The catalog from a rules document (`BUSINESS_RULES.md` of the generated views, or one unit's `rules.md`: a
 * `### <id>: <name>` card per rule), with the data objects document as the objects' source. Look-alike rules are
 * grouped (`duplicateGroup`).
 */
export function ruleCatalog(rulesText: string | null, dataObjectsText: string | null): RuleCatalog {
  const rules = (rulesText === null ? [] : parseRules(rulesText).rules).map(fromCard)

  return {
    rules: markDuplicates(rules.sort(byId)),
    dataObjects: dataObjectsText === null ? [] : parseDataObjects(dataObjectsText),
    source: rules.length === 0 ? 'none' : 'markdown',
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
