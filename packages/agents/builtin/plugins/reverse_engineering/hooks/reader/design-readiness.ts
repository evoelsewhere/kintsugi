import { documentOf } from './document.js'
import { gapIsResolved, inspectSpecGaps } from './gaps.js'
import { parseLedger } from './ledger.js'
import { parseRules } from './rules.js'

/** Input evidence, at the same pinned commit as the design templates. Never inferred from a successful run. */
export type DesignInputs = { specification?: string | undefined; understanding?: string | undefined; rules?: string | undefined; review?: string | undefined; catalogDigest?: string | undefined }

export function designInputBlockers(input: DesignInputs): string[] {
  const blockers: string[] = []
  const record = documentOf(input.understanding ?? '').data
  if (record['status'] !== 'understood') blockers.push('Understand the unit and merge its pull request first.')
  if (input.catalogDigest === undefined || input.catalogDigest === '' || record['digest'] !== input.catalogDigest) blockers.push('The understanding is not current with the active catalog; run understand again.')
  if (record['profileMissing'] !== undefined && (!Array.isArray(record['profileMissing']) || record['profileMissing'].length > 0)) blockers.push('The understanding is missing specification-profile sections.')
  if (input.specification === undefined || input.specification.trim() === '') blockers.push('The merged AS-IS specification is missing.')
  else {
    const checked = inspectSpecGaps(input.specification)
    blockers.push(...checked.problems)
    for (const gap of checked.gaps) if (gap.impact === 'blocking' && !gapIsResolved(gap)) blockers.push(`Resolve ${gap.id} in the specification: ${gap.question}`)
  }
  if (input.rules === undefined || input.rules.trim() === '') blockers.push('The merged rules document is missing; understand the unit first.')
  else {
    const parsed = parseRules(input.rules)
    if (parsed.rules.length === 0 && documentOf(input.rules).data['rules'] !== 0 && !/no business rules (?:were )?(?:found|confirmed)/i.test(input.rules)) blockers.push('The rules document has no readable rules or explicit zero-rule result.')
    const ledger = parseLedger(input.review ?? null)
    for (const rule of parsed.rules) {
      if (rule.ruleStatus === 'retired') continue
      const verdict = ledger[rule.id]?.verdict
      if (verdict === 'clarify' || (verdict !== 'confirmed' && verdict !== 'refuted' && (rule.ruleStatus === 'needs-sme' || (rule.confidence !== undefined && rule.confidence.toLowerCase() !== 'high')))) blockers.push(`Resolve rule ${rule.id} with its evidence and rule review before design.`)
    }
  }
  return blockers
}
