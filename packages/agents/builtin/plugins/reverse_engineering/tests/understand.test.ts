import { describe, expect, test } from 'vitest'

import { parsePlan } from '../hooks/reader/plan.js'
import { buildTraceability, leftOutTotal, parseTraceSummary, parseUnitTrace, type UnitFacts } from '../hooks/reader/traceability.js'
import { frontmatterOf, parseWorkItem } from '../hooks/reader/work-item.js'
import type { ItemCatalogItem } from '../hooks/reader/item-catalog.js'

// What finish_items.py writes (scripts/finish_items.py, render_trace()).
const TRACE = `---
app: "billing"
item: "core/invoice"
generatedBy: "finish_items.py"
openQuestions: 2
---
# Traceability - core/invoice

## Entry points

- \`src/INVOICE.cbl:12\`

## Rules applied

- \`RULE-core.invoice-1a2b3c4d\`
- \`RULE-core.invoice-5e6f7a8b\`

## Findings

## Dependencies

| Target | Kind | Direction |
| --- | --- | --- |
| data/ledger | call | outbound |
| ds:ACCOUNT | read | outbound |
| ds:ACCOUNT | write | outbound |
| web/portal | call | inbound |
| ../bad | call | outbound |

## Data objects

- INVOICE-REC

## External systems

- Bank gateway

## Files

- \`src/INVOICE.cbl\`
- \`../etc/passwd\`
- \`src/./FEES.cpy\`

## Requirements

- REQ-INV-01

## Pull requests

- PR-123

## Tests

- tests/invoice.test
`

const item = (id: string, extra: Partial<ItemCatalogItem> = {}): ItemCatalogItem => ({
  id,
  module: id.split('/')[0] ?? '',
  kind: 'program',
  name: id.split('/')[1] ?? id,
  summary: '',
  files: ['src/x.cbl'],
  leaves: [],
  entryPoints: [],
  loc: 100,
  complexity: 'low',
  digest: '',
  status: 'active',
  aliases: [],
  parts: [],
  dependsOn: [],
  usedBy: [],
  dataStores: [],
  ...extra,
})

describe('unit trace', () => {
  test('reads the sections of a unit trace.md, dropping what does not fit', () => {
    const trace = parseUnitTrace(TRACE)!
    expect(trace.entryPoints).toEqual(['src/INVOICE.cbl:12'])
    expect(trace.rulesApplied).toEqual(['RULE-core.invoice-1a2b3c4d', 'RULE-core.invoice-5e6f7a8b'])
    expect(trace.findings).toEqual([])
    expect(trace.dependencies).toEqual([
      { target: 'data/ledger', kind: 'call', direction: 'outbound' },
      { target: 'ds:ACCOUNT', kind: 'read', direction: 'outbound' },
      { target: 'ds:ACCOUNT', kind: 'write', direction: 'outbound' },
      { target: 'web/portal', kind: 'call', direction: 'inbound' },
      { target: '../bad', kind: 'call', direction: 'outbound' },
    ])
    expect(trace.files).toEqual(['src/INVOICE.cbl', 'src/FEES.cpy'])
    expect(trace).toMatchObject({ dataObjects: ['INVOICE-REC'], externalSystems: ['Bank gateway'], requirements: ['REQ-INV-01'], pullRequests: ['PR-123'], tests: ['tests/invoice.test'], openQuestions: 2 })
  })

  test('is null for text without sections', () => {
    expect(parseUnitTrace('not a trace')).toBeNull()
    expect(parseUnitTrace('')).toBeNull()
  })
})

describe('traceability', () => {
  test('builds the matrix of the understood units, with the reverse indexes', () => {
    const facts: UnitFacts[] = [
      { item: item('core/invoice', { entryPoints: ['INV'], loc: 420, name: 'Invoice' }), trace: parseUnitTrace(TRACE), spec: '10-applications/billing/01-legacy/core/invoice/spec.md' },
      { item: item('data/ledger', { loc: 80, files: ['src/ledger.cbl'] }), trace: null, spec: '10-applications/billing/01-legacy/data/ledger/spec.md' },
    ]
    const matrix = buildTraceability('billing', facts, { businessRules: true, securityFindings: false })
    expect(matrix.inputs).toEqual({ businessRules: true, securityFindings: false })
    expect(matrix.units.map(unit => [unit.id, unit.key, unit.entryPoint, unit.loc, unit.title])).toEqual([
      ['billing/core/invoice', 'core/invoice', true, 420, 'Invoice'],
      ['billing/data/ledger', 'data/ledger', false, 80, 'ledger'],
    ])
    const [invoice, ledger] = matrix.units
    // A dependency on a unit that is not understood (the ../bad target, web/portal) is not a link.
    expect(invoice?.dependsOn).toEqual(['billing/data/ledger'])
    expect(invoice?.usedBy).toEqual([])
    expect(invoice?.dataStores).toEqual([{ id: 'ds:ACCOUNT', access: ['read', 'write'] }])
    expect(invoice?.files).toEqual(['src/INVOICE.cbl', 'src/FEES.cpy'])
    expect(invoice).toMatchObject({ rules: ['RULE-core.invoice-1a2b3c4d', 'RULE-core.invoice-5e6f7a8b'], externalSystems: ['Bank gateway'], requirements: ['REQ-INV-01'], openQuestions: 2 })
    expect(ledger).toMatchObject({ files: ['src/ledger.cbl'], rules: [], requirements: [], pullRequests: [], tests: [], openQuestions: 0 })
    expect(matrix.rules['RULE-core.invoice-1a2b3c4d']).toEqual(['billing/core/invoice'])
    expect(matrix.requirements).toEqual({ 'REQ-INV-01': ['billing/core/invoice'] })
    expect(matrix.pullRequests).toEqual({ 'PR-123': ['billing/core/invoice'] })
    expect(matrix.tests).toEqual({ 'tests/invoice.test': ['billing/core/invoice'] })
    expect(matrix.dataStores).toEqual({ 'ds:ACCOUNT': ['billing/core/invoice'] })
    expect(leftOutTotal(matrix)).toBe(0)
  })

  test('reads the totals the generated traceability.md keeps in its front matter', () => {
    const summary = parseTraceSummary(
      '---\napp: "billing"\nitems: 5\nunits: 2\nmodules: 1\nspecified: 2\nentryPoints: 1\nrulesCovered: 7\nfindingsMapped: 3\nfiles: 40\ndataStores: 2\nrequirements: 1\nopenQuestions: 4\nstale: 1\nbusinessRules: true\nsecurityFindings: false\n---\n# Traceability - billing\n',
    )
    expect(summary).toEqual({
      app: 'billing',
      items: 5,
      units: 2,
      modules: 1,
      specified: 2,
      entryPoints: 1,
      rulesCovered: 7,
      findingsMapped: 3,
      files: 40,
      dataStores: 2,
      requirements: 1,
      openQuestions: 4,
      stale: 1,
      inputs: { businessRules: true, securityFindings: false },
    })
    expect(parseTraceSummary('# no totals')).toBeNull()
  })
})

// What finish_items.py writes (scripts/finish_items.py, work_item()).
const WORK_ITEM = `---
id: "billing/core/invoice"
application: "billing"
module: "core"
kind: "program"
title: "Invoice"
phase: discover-assess
stage: understand
status: pending
complexity: low
dependsOn: ["billing/data/ledger"]
source:
  - {repo: "legacy", paths: ["src/INVOICE.cbl"]}
links:
  asIs: "10-applications/billing/01-legacy/core/invoice/spec.md"
  businessRules: ["RULE-001", "RULE-002"]
---

Invoice: proposed by the understand stage from the catalog of billing.
`

describe('unit files', () => {
  test('reads the work item state the results view shows', () => {
    expect(parseWorkItem(WORK_ITEM)).toEqual({
      id: 'billing/core/invoice',
      status: 'pending',
      title: 'Invoice',
      module: 'core',
      kind: 'program',
      phase: 'discover-assess',
      stage: 'understand',
      complexity: 'low',
      dependsOn: ['billing/data/ledger'],
      links: { asIs: '10-applications/billing/01-legacy/core/invoice/spec.md', businessRules: ['RULE-001', 'RULE-002'] },
    })
  })

  test('keeps plain YAML values, lists and the body; no frontmatter is null', () => {
    const document = frontmatterOf("---\r\nstatus: in-progress\r\nassignee: 'jane'\r\ntags:\r\n  - a\r\n  - \"b\"\r\nwave: 2\r\n---\r\nBody\r\n")
    expect(document).toEqual({ data: { status: 'in-progress', assignee: 'jane', tags: ['a', 'b'], wave: 2 }, body: 'Body' })
    expect(frontmatterOf('# Title\n')).toBeNull()
    expect(frontmatterOf('---\nstatus: pending\n')).toBeNull()
    expect(parseWorkItem('no frontmatter')).toBeNull()
  })
})

// What check_plan.py writes (scripts/check_plan.py, render_plan()).
const PLAN = `---
version: 1
app: "shop"
generatedBy: "plan_understand"
catalogCommit: "${'a'.repeat(40)}"
items: 6
open: 5
batches: 2
planned: 3
---
# Plan to understand shop

Foundations first, then what uses them.

## Batch 1: Foundations

Everything calls them.

- **risk:** high
- **loc:** 2400
- **high complexity:** 2
- **cohesion:** 1.0

### Items

- \`core/base\`
- \`core/service\`

## Batch 2: Entry

Needs both.

- **risk:** medium
- **loc:** 300
- **high complexity:** 0
- **cohesion:**

### Items

- \`web/entry\`

### Depends on outside

| Item | Used by |
| --- | --- |
| core/old | web/entry, web/other |

## Left out

| Item | Reason |
| --- | --- |
| batch/a | Low value. |

## Dropped

Named by the planner and refused by the check.

| Item | Reason |
| --- | --- |
| nope/x | not an item of the catalog |
`

describe('plan', () => {
  test('reads the strategy, the batches, what was left out and what was dropped', () => {
    const plan = parsePlan(PLAN)!
    expect(plan.app).toBe('shop')
    expect(plan.catalog).toEqual({ commit: 'a'.repeat(40), items: 6, open: 5 })
    expect(plan.strategy).toBe('Foundations first, then what uses them.')
    expect(plan.summary).toEqual({ batches: 2, planned: 3, open: 5 })
    expect(plan.batches).toEqual([
      { n: 1, title: 'Foundations', rationale: 'Everything calls them.', risk: 'high', items: ['core/base', 'core/service'], loc: 2400, high: 2, cohesion: 1, dependsOutside: [] },
      { n: 2, title: 'Entry', rationale: 'Needs both.', risk: 'medium', items: ['web/entry'], loc: 300, high: 0, cohesion: null, dependsOutside: [{ item: 'core/old', usedBy: ['web/entry', 'web/other'] }] },
    ])
    expect(plan.leftOut).toEqual([{ item: 'batch/a', reason: 'Low value.' }])
    expect(plan.dropped).toEqual([{ item: 'nope/x', reason: 'not an item of the catalog' }])
  })

  test('is null for text that is not a plan', () => {
    expect(parsePlan('not a plan')).toBeNull()
    expect(parsePlan('---\nversion: 2\n---\n## Batch 1: x\n')).toBeNull()
    expect(parsePlan('---\nversion: 1\napp: "x"\n---\n# Plan\n')).toBeNull()
  })
})
