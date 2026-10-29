import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { answerSpecGap, gapIsResolved, inspectSpecGaps, countGaps, parseGaps, parseSpecGaps } from '../hooks/reader/gaps.js'

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

  test('who settles a gap is its Settled by, or its kind\'s default when the row names none or another value (ADR-0087)', () => {
    const gaps = parseSpecGaps(SPEC, 'tax/calc') ?? []

    expect(gaps.map(gap => [gap.id, gap.settledBy, gap.probe])).toEqual([
      ['GAP-tax.calc-03', 'check', undefined],
      ['GAP-tax.calc-01', 'source-owner', 'Ask the owners of the copybook library for TAXTAB.'],
      ['GAP-tax.calc-02', 'expert', 'Ask the tax team which rate applies.'],
    ])
    expect(countGaps(gaps).bySettler).toEqual({ 'source-owner': 1, expert: 1, data: 0, check: 1 })
    expect(inspectSpecGaps(SPEC).problems.filter(problem => /settled/i.test(problem))).toEqual([])
    expect(parseGaps(GAPS).gaps.map(gap => gap.settledBy)).toEqual(['source-owner', 'expert', 'data'])
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

describe('answers in the original specification', () => {
  const spec = '# Tax\n\n## Logic\n\nThe rate is unknown (gap: GAP-M101-0001).\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Which rate? | legacy/tax.cbl:4 | blocking |\n| GAP-M101-0002 | unverified | Which tests? | legacy/tax.cbl:5 | note |\n\n## Sources\n\nLeave this paragraph unchanged.\n'

  test('adds answer columns in place, preserving ID, question, evidence location and surrounding sections', () => {
    const updated = answerSpecGap(spec, 'GAP-M101-0001', 'Use 8% | round down.', 'REQ-1 reviewed by finance.', 'resolved')
    expect(updated.split('## Gaps and questions')[0]).toBe(spec.split('## Gaps and questions')[0])
    expect(updated.split('## Sources')[1]).toBe(spec.split('## Sources')[1])
    expect(inspectSpecGaps(updated).problems).toEqual([])
    const gaps = parseSpecGaps(updated)!
    expect(gaps[0]).toMatchObject({ id: 'GAP-M101-0001', question: 'Which rate?', where: 'legacy/tax.cbl:4', answer: 'Use 8% | round down.', status: 'resolved' })
    expect(countGaps(gaps)).toMatchObject({ total: 2, open: 1, resolved: 1 })
    expect(gapIsResolved(parseSpecGaps(answerSpecGap(updated, 'GAP-M101-0001', 'Decision withdrawn.', 'REQ-2', 'open'))![0]!)).toBe(false)
  })

  test('refuses wrong IDs, malformed tables, placeholder answers and multiline injection', () => {
    expect(() => answerSpecGap(spec, 'GAP-M101-0099', 'Use 8%.', 'REQ-1', 'resolved')).toThrow(/not in this specification/)
    expect(() => answerSpecGap(spec, 'GAP-M101-0001', 'TODO', 'REQ-1', 'resolved')).toThrow(/meaningful/)
    expect(() => answerSpecGap(spec, 'GAP-M101-0001', 'answer\n## Other', 'REQ-1', 'resolved')).toThrow(/single-line/)
    expect(inspectSpecGaps(SPEC).problems.length).toBeGreaterThan(0)
    expect(gapIsResolved({ status: 'resolved' })).toBe(false)
  })
})

 test('edits the actual table even when preceding prose or fenced examples start with a pipe', () => {
   const prelude = '| A quoted line, not a table\n\n```markdown\n| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n| GAP-EXAMPLE-0001 | ambiguous | Example? | example | note |\n```\n\n'
   const original = '# Spec\n\n## Gaps and questions\n\n' + prelude + '| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Rate? | legacy/tax.cbl:4 | blocking |\n'
   // An example uses an ID that belongs to no real row; strict readiness reports it rather than discarding it.
   expect(inspectSpecGaps(original).problems.length).toBeGreaterThan(0)
   const withoutExampleId = original.replace('GAP-EXAMPLE-0001', 'example')
   const changed = answerSpecGap(withoutExampleId, 'GAP-M101-0001', 'Use 8%.', 'REQ-1', 'resolved')
   expect(changed).toContain(prelude.replace('GAP-EXAMPLE-0001', 'example'))
   expect(parseSpecGaps(changed)![0]?.answer).toBe('Use 8%.')
 })
