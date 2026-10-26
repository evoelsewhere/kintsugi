import { describe, expect, test } from 'vitest'
import { designInputBlockers, type DesignInputs } from '../hooks/reader/design-readiness.js'

const ready: DesignInputs = { understanding: '---\nstatus: understood\ndigest: sha256:abc\n---\n', catalogDigest: 'sha256:abc', specification: '# Spec\n\n## Gaps and questions\n\nNone.\n', rules: '# Rules\n\nNo business rules were found.\n' }
const gapSpec = (impact: string, resolution = ''): string => `# Spec\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact ${resolution ? '| Status | Answer | Evidence ' : ''}|\n| --- | --- | --- | --- | --- ${resolution ? '| --- | --- | --- ' : ''}|\n| GAP-M101-0001 | ambiguous | Which rate? | legacy/tax.cbl:4 | ${impact} ${resolution ? `| ${resolution} ` : ''}|\n`

describe('final design input guard', () => {
  test('accepts evidenced understanding with an explicitly empty gap register and a valid zero-rule unit', () => {
    expect(designInputBlockers(ready)).toEqual([])
  })
  test('does not infer understanding, freshness or a gap-free specification from missing inputs', () => {
    expect(designInputBlockers({})).toHaveLength(4)
    expect(designInputBlockers({ ...ready, catalogDigest: 'sha256:new' }).join()).toMatch(/not current/)
    expect(designInputBlockers({ ...ready, specification: '# Old spec' }).join()).toMatch(/Gaps and questions/)
    expect(designInputBlockers({ ...ready, understanding: '---\nstatus: understood\ndigest: sha256:abc\nprofileMissing: [Inputs]\n---\n' }).join()).toMatch(/profile/)
  })
  test('blocks open blocking gaps, accepts merged evidenced resolutions, and allows risk/note gaps', () => {
    expect(designInputBlockers({ ...ready, specification: gapSpec('blocking') }).join()).toMatch(/GAP-M101-0001/)
    expect(designInputBlockers({ ...ready, specification: gapSpec('blocking', 'resolved | Use 8%. | REQ-1 approved by finance.') })).toEqual([])
    expect(designInputBlockers({ ...ready, specification: gapSpec('blocking', 'resolved | TODO | REQ-1') }).length).toBeGreaterThan(0)
    for (const impact of ['risk', 'note']) expect(designInputBlockers({ ...ready, specification: gapSpec(impact) })).toEqual([])
  })
  test('requires unresolved rule confidence or a clarify verdict to be settled in the rule review', () => {
    const rules = '# Rules\n\n| ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| RULE-M101-0001 | Rate | Calculation | P0 | Low | 1 | needs-sme | legacy/tax.cbl:4 | rules/RULE-M101-0001.md |\n'
    expect(designInputBlockers({ ...ready, rules }).join()).toMatch(/RULE-M101-0001/)
    const review = '# Review\n\n| Rule | Verdict | Approver | Date | Note |\n| --- | --- | --- | --- | --- |\n| RULE-M101-0001 | confirmed | Finance | 2026-10-26 | REQ-1 |\n'
    expect(designInputBlockers({ ...ready, rules, review })).toEqual([])
    expect(designInputBlockers({ ...ready, rules, review: review.replace('confirmed', 'clarify') }).join()).toMatch(/RULE-M101-0001/)
  })
})
