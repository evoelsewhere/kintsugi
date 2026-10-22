import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { countGaps, parseGaps, parseSpecGaps } from '../hooks/reader/gaps.js'

// The specification scripts/gaps_common.py reads in its tests (scripts/tests/fixtures/gaps/spec.md): one parser per language, one fixture.
const SPEC = readFileSync(fileURLToPath(new URL('../scripts/tests/fixtures/gaps/spec.md', import.meta.url)), 'utf8')

// What rebuild_aggregates.py writes (gaps_md()).
const GAPS = `---
app: "billing"
generatedBy: "rebuild_aggregates.py"
gaps: 3
---
# Gaps and questions - billing

| Item | ID | Kind | Impact | Question | Where |
| --- | --- | --- | --- | --- | --- |
| tax/calc | GAP-tax.calc-01 | missing-source | blocking | What does copybook TAXTAB hold? | legacy/src/TAX.cbl:41 |
| tax/calc | GAP-tax.calc-02 | ambiguous | risk | Why 0.0825? | RULE-tax.calc-01 |
| invoicing/entry | GAP-invoicing.entry-01 | unresolved | note | Which table does the dispatcher read? | - |
`

describe('gaps', () => {
  test('a specification lists its gaps, skipping a repeated id and a row that is not a gap', () => {
    const gaps = parseSpecGaps(SPEC, 'tax/calc') ?? []

    expect(gaps.map(gap => [gap.id, gap.kind, gap.impact, gap.item])).toEqual([
      ['GAP-tax.calc-03', 'unverified', 'note', 'tax/calc'],
      ['GAP-tax.calc-01', 'missing-source', 'blocking', 'tax/calc'],
      ['GAP-tax.calc-02', 'ambiguous', 'risk', 'tax/calc'],
    ])
    expect(gaps[1]).toMatchObject({ question: 'What does copybook TAXTAB hold? It is COPYed but is in no repository.', where: 'legacy/src/TAX.cbl:41' })
    expect(countGaps(gaps)).toMatchObject({ total: 3, units: 1, byImpact: { blocking: 1, risk: 1, note: 1 }, byKind: { 'missing-source': 1, unresolved: 0, ambiguous: 1, unverified: 1 } })
  })

  test('a specification without the section is null, and with no rows has no gaps', () => {
    expect(parseSpecGaps('# Tax\n\n## Purpose\n\nRounds.\n')).toBeNull()
    expect(parseSpecGaps('# Tax\n\n## Gaps and questions\n\nNone.\n')).toEqual([])
  })

  test('the application view reads the item of each row', () => {
    const { gaps, counts } = parseGaps(GAPS)

    expect(gaps.map(gap => [gap.item, gap.id])).toEqual([
      ['tax/calc', 'GAP-tax.calc-01'],
      ['tax/calc', 'GAP-tax.calc-02'],
      ['invoicing/entry', 'GAP-invoicing.entry-01'],
    ])
    expect(counts).toMatchObject({ total: 3, units: 2 })
    expect(parseGaps('not a table')).toEqual({ gaps: [], counts: countGaps([]) })
  })
})
