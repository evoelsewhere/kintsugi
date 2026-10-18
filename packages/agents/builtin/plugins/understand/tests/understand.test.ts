import { describe, expect, test } from 'vitest'

import { leftOutTotal, parseTraceability } from '../hooks/reader/traceability.js'
import { frontmatterOf, parseWorkItem } from '../hooks/reader/work-item.js'

// The shape merge_traceability.py writes (scripts/merge_traceability.py, merge()).
const MATRIX = {
  app: 'billing',
  generatedBy: 'merge_traceability.py',
  inputs: { businessRules: true, securityFindings: false },
  units: [
    {
      id: 'billing/core/invoice',
      module: 'core',
      unit: 'invoice',
      title: 'Invoice',
      kind: 'program',
      loc: 420,
      entryPoint: true,
      spec: 'applications/billing/units/core/invoice/as-is.md',
      files: ['src/INVOICE.cbl', '../etc/passwd', 'src/./FEES.cpy'],
      dependsOn: ['billing/data/ledger'],
      usedBy: [],
      dataStores: [{ id: 'ds:ACCOUNT', access: ['read', 'write'] }, { access: ['read'] }],
      externalSystems: ['Bank gateway'],
      rules: ['RULE-001', 'RULE-002'],
      findings: [],
      dataObjects: ['INVOICE-REC'],
      entryPoints: ['src/INVOICE.cbl:12'],
      requirements: ['REQ-INV-01'],
      pullRequests: ['PR-123'],
      tests: ['tests/invoice.test'],
      openQuestions: 2,
    },
    { id: 'billing/data/ledger', module: 'data', unit: 'ledger', title: 'Ledger', kind: 'program', loc: 80, entryPoint: false, spec: null, files: 'not a list', dependsOn: [], usedBy: ['billing/core/invoice'] },
    { title: 'no id' },
    { id: 'billing/data/ledger', module: 'data', unit: 'duplicate' },
  ],
  rules: { 'RULE-001': ['billing/core/invoice'], 'RULE-002': ['billing/core/invoice'] },
  findings: {},
  files: { 'src/INVOICE.cbl': ['billing/core/invoice'] },
  requirements: { 'REQ-INV-01': ['billing/core/invoice'] },
  pullRequests: { 'PR-123': ['billing/core/invoice'] },
  tests: { 'tests/invoice.test': ['billing/core/invoice'] },
  dataStores: { 'ds:ACCOUNT': ['billing/core/invoice'] },
  unmappedRules: ['RULE-003'],
  unmappedFindings: [],
  cycles: [['billing/core/invoice', 'billing/data/ledger'], ['alone']],
  notes: { 'unknown rule ids': 2, 'files not in the source': 1, bogus: 'x' },
}

describe('traceability', () => {
  test('reads units, indexes, what no unit covers and the left-out counts, dropping what does not fit', () => {
    const matrix = parseTraceability(JSON.stringify(MATRIX))
    expect(matrix).not.toBeNull()
    expect(matrix?.inputs).toEqual({ businessRules: true, securityFindings: false })
    expect(matrix?.units.map(unit => [unit.id, unit.key, unit.spec, unit.entryPoint, unit.loc])).toEqual([
      ['billing/core/invoice', 'core/invoice', 'applications/billing/units/core/invoice/as-is.md', true, 420],
      ['billing/data/ledger', 'data/ledger', null, false, 80],
    ])
    const [invoice, ledger] = matrix?.units ?? []
    expect(invoice?.files).toEqual(['src/INVOICE.cbl', 'src/FEES.cpy'])
    expect(invoice?.dataStores).toEqual([{ id: 'ds:ACCOUNT', access: ['read', 'write'] }])
    expect(invoice).toMatchObject({ rules: ['RULE-001', 'RULE-002'], externalSystems: ['Bank gateway'], requirements: ['REQ-INV-01'], pullRequests: ['PR-123'], tests: ['tests/invoice.test'], openQuestions: 2 })
    expect(ledger).toMatchObject({ files: [], usedBy: ['billing/core/invoice'], rules: [], requirements: [], pullRequests: [], tests: [], openQuestions: 0 })
    expect(matrix?.rules['RULE-001']).toEqual(['billing/core/invoice'])
    expect(matrix?.requirements).toEqual({ 'REQ-INV-01': ['billing/core/invoice'] })
    expect(matrix?.pullRequests).toEqual({ 'PR-123': ['billing/core/invoice'] })
    expect(matrix?.tests).toEqual({ 'tests/invoice.test': ['billing/core/invoice'] })
    expect(matrix?.unmappedRules).toEqual(['RULE-003'])
    expect(matrix?.cycles).toEqual([['billing/core/invoice', 'billing/data/ledger']])
    expect(matrix?.notes).toEqual({ 'unknown rule ids': 2, 'files not in the source': 1 })
    expect(leftOutTotal(matrix!)).toBe(3)
  })

  test('derives module and unit from the id when they are missing; refuses text that is not a matrix', () => {
    expect(parseTraceability(JSON.stringify({ units: [{ id: 'app/m/u' }] }))?.units[0]).toMatchObject({ module: 'm', unit: 'u', key: 'm/u', title: 'u', spec: null })
    expect(parseTraceability('not json')).toBeNull()
    expect(parseTraceability(JSON.stringify({ units: 'x' }))).toBeNull()
    expect(parseTraceability(JSON.stringify({ app: 'a', units: [] }))?.units).toEqual([])
  })
})

// What write_work_items.py writes (scripts/write_work_items.py, frontmatter()).
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
  asIs: "applications/billing/units/core/invoice/as-is.md"
  businessRules: ["RULE-001", "RULE-002"]
---

Invoice: proposed by the understand stage from the map of billing.
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
      links: { asIs: 'applications/billing/units/core/invoice/as-is.md', businessRules: ['RULE-001', 'RULE-002'] },
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
