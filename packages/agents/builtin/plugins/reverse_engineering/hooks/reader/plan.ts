import { cardsOf, countOf, documentOf, fieldText, itemsOf, recordsOf, sectionText, textOf } from './document.js'
import { paragraphsIn, sectionsOf, tablesIn } from './markdown.js'

/**
 * The plan of what to understand next (ADR-0041, ADR-0051): `01-legacy/plan.md`, written by
 * `scripts/check_plan.py` after the planner's draft was checked against the item graph. Front matter with the
 * totals, the strategy, one `## Batch <n>: <title>` section per batch (the rationale, the fields `risk`, `loc`,
 * `high complexity` and `cohesion`, the items, what it still depends on outside) and the tables `Left out` and
 * `Dropped`. Every field is read as optional; null when the text is not a plan.
 */

export type PlanBatch = {
  n: number
  title: string
  rationale: string
  risk: 'high' | 'medium' | 'low'
  items: string[]
  loc: number
  high: number
  /** Calls inside the batch over all calls its items make to other items; null when they call none. */
  cohesion: number | null
  /** Items outside the batch, not understood and not in an earlier batch, that its items depend on. */
  dependsOutside: { item: string; usedBy: string[] }[]
}

export type UnderstandPlan = {
  version: number
  app: string
  strategy: string
  catalog: { commit?: string; items: number; open: number }
  batches: PlanBatch[]
  leftOut: { item: string; reason: string }[]
  dropped: { item: string; reason: string }[]
  summary: { batches: number; planned: number; open: number }
}

const MAX_BATCHES = 50
const MAX_LIST = 500

const reasons = (body: string): { item: string; reason: string }[] =>
  recordsOf(tablesIn(body)[0])
    .flatMap(row => (row.item ? [{ item: row.item.replace(/`/g, ''), reason: row.reason ?? '' }] : []))
    .slice(0, MAX_LIST)

/** Parses plan.md; null when the text is not a plan (no version 1 front matter, or no batch). */
export function parsePlan(text: string): UnderstandPlan | null {
  const { data, body } = documentOf(text)

  if (data.version !== 1) return null

  const intro = body.split(/^## /m)[0] ?? ''
  const strategy = paragraphsIn(intro.replace(/^# .*$/m, '')).join(' ')
  const sections = sectionsOf(body).filter(section => section.level === 2)

  const batches = cardsOf(body, 2)
    .filter(card => /^Batch \d+$/.test(card.id))
    .slice(0, MAX_BATCHES)
    .map((card): PlanBatch => {
      const risk = fieldText(card, 'risk')
      const cohesion = fieldText(card, 'cohesion')

      return {
        n: Number(card.id.split(' ')[1]),
        title: card.title,
        rationale: card.prose,
        risk: risk === 'high' || risk === 'low' ? risk : 'medium',
        items: itemsOf(sectionText(card, 'Items')).slice(0, MAX_LIST),
        loc: countOf(fieldText(card, 'loc')),
        high: countOf(fieldText(card, 'high complexity')),
        cohesion: cohesion === undefined ? null : Number(cohesion),
        dependsOutside: recordsOf(tablesIn(sectionText(card, 'Depends on outside'))[0]).flatMap(row =>
          row.item ? [{ item: row.item.replace(/`/g, ''), usedBy: (row['used by'] ?? '').split(',').map(part => part.trim().replace(/`/g, '')).filter(Boolean) }] : [],
        ),
      }
    })

  if (batches.length === 0) return null

  const commit = textOf(data.catalogCommit, 80)

  return {
    version: 1,
    app: textOf(data.app) ?? '',
    strategy,
    catalog: { ...(commit === undefined ? {} : { commit }), items: countOf(data.items), open: countOf(data.open) },
    batches,
    leftOut: reasons(sections.find(section => section.title === 'Left out')?.body ?? ''),
    dropped: reasons(sections.find(section => section.title === 'Dropped')?.body ?? ''),
    summary: { batches: batches.length, planned: countOf(data.planned), open: countOf(data.open) },
  }
}
