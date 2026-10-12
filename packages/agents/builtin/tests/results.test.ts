import { describe, expect, test } from 'vitest'

import { ruleCatalog, parseDataObjects } from '../hooks/reader/catalog.js'
import { parseSecurityFindings, patchSummary } from '../hooks/reader/findings.js'
import { parseInventory } from '../hooks/reader/inventory.js'
import { bulletsIn, sectionsOf, tablesIn } from '../hooks/reader/markdown.js'
import { parseTopology } from '../hooks/reader/topology.js'

describe('markdown', () => {
  test('sections own their content up to the next heading of the same level; fences hide headings', () => {
    const sections = sectionsOf('# Title\nintro\n## A\na\n### A.1\n```\n# not a heading\n```\n## B\nb\n')
    expect(sections.map(section => [section.level, section.title, section.line])).toEqual([
      [1, 'Title', 0],
      [2, 'A', 2],
      [3, 'A.1', 4],
      [2, 'B', 8],
    ])
    expect(sections[1]?.body).toContain('# not a heading')
    expect(sections[3]?.body).toBe('b\n')
  })

  test('tables keep pipes inside code spans and escaped pipes', () => {
    const [table] = tablesIn('| ID | Note |\n|---|:--:|\n| **A-1** | `a | b` and c\\|d |\n\ntext')
    expect(table).toEqual({ header: ['ID', 'Note'], rows: [['A-1', '`a | b` and c|d']] })
  })

  test('bullets join their continuation lines', () => {
    expect(bulletsIn('- one\n  more\n- two\n\nafter')).toEqual(['one more', 'two'])
  })
})

describe('inventory', () => {
  test('reads the figures of record, per language and per file, without the .git pointer', () => {
    const inventory = parseInventory(
      JSON.stringify({
        app: 'billing',
        fileCount: 3,
        sloc: 30,
        ksloc: 0.03,
        complexityIndex: 0.11,
        languages: { Java: 1, SQL: 1 },
        languageMetrics: { Java: { files: 1, lines: 30, sloc: 24, complexity: 3 } },
        files: [
          { path: '.git', bytes: 10, language: 'Other' },
          { path: 'A.java', language: 'Java', lines: 30, sloc: 24, cyclomaticComplexity: 3, bytes: 900 },
          { path: 'schema.sql', language: 'SQL', lines: 6, codeLines: 6, bytes: 100 },
        ],
      }),
    )
    expect(inventory).toMatchObject({ app: 'billing', fileCount: 3, sloc: 30, complexityIndex: 0.11 })
    expect(inventory?.files.map(file => [file.path, file.sloc, file.complexity])).toEqual([
      ['A.java', 24, 3],
      ['schema.sql', 6, 0],
    ])
    expect(inventory?.languages).toEqual([
      { language: 'Java', files: 1, lines: 30, sloc: 24, complexity: 3 },
      { language: 'SQL', files: 1, lines: 6, sloc: 6, complexity: 0 },
    ])
  })

  test('is null for text that is not an inventory', () => {
    expect(parseInventory('not json')).toBeNull()
    expect(parseInventory('[]')).toBeNull()
    expect(parseInventory('{}')).toBeNull()
  })
})

describe('topology', () => {
  test('keeps node descriptions, flow descriptions and observations', () => {
    const topology = parseTopology(
      JSON.stringify({
        system: 'Billing',
        root: { id: 'sys', kind: 'system', children: [{ id: 'dom:a', name: 'A', kind: 'domain', children: [{ id: 'm1', kind: 'module', loc: 3, file: 'a.java', description: 'Reads accounts.' }] }] },
        flows: [{ name: 'Flow', description: 'Plain words.', steps: [] }],
        observations: ['Coupling.', 3],
      }),
    )
    expect(topology?.nodes[0]).toMatchObject({ id: 'm1', domain: 'A', description: 'Reads accounts.' })
    expect(topology?.flows[0]?.description).toBe('Plain words.')
    expect(topology?.observations).toEqual(['Coupling.'])
  })
})

const RESULT = {
  confirmedRules: [
    { name: 'Monthly interest is balance times rate divided by twelve', category: 'Calculation', priority: 'P0', source: 'src/A.java:15-17', confidence: 'High', edgeCases: ['zero rate'] },
    { name: 'Monthly interest is one twelfth of balance times rate', category: 'Calculation', priority: 'P0', source: 'src/A.java:18', confidence: 'High' },
    { name: 'Late fee applies after 30 days', category: 'Calculation', priority: 'P0', source: 'src/A.java:19', confidence: 'Medium', smeQuestion: 'Is it 30 or 31?' },
    { name: 'Unknown accounts are rejected', category: 'Validation', priority: 'P1', source: 'src/R.java:20' },
  ],
  rejectedRules: [{ name: 'Balance is never negative', category: 'Policy', priority: 'P1', source: 'schema.sql:1-6', rejectionReason: 'refuted: no constraint' }],
  dataObjects: [{ name: 'Account', source: 'src/Account.java:5', fields: [{ name: 'id', type: 'String' }], consumedBy: ['Late fee applies after 30 days'] }],
  stats: { confirmed: 4, rejected: 1, p0: 3, skippedPhases: ['round 2 skipped'] },
}

const RULES_MD = `# Business Rules

## Calculation

### RULE-001: Monthly interest is balance times rate divided by twelve
**Category:** Calculation
**Priority:** P0
**Source:** \`src/A.java:15-17\`
**Plain English:** Interest is a twelfth of the yearly rate.
**Confidence:** High

### RULE-002: Monthly interest is one twelfth of balance times rate
**Priority:** P0
**Source:** \`src/A.java:18\`

### RULE-003: Late fee applies after 30 days
**Priority:** P0
**Source:** \`src/A.java:19\`

## Validation

### RULE-004: Unknown accounts are rejected
**Priority:** P1
**Source:** \`src/R.java:20\`
`

describe('rule catalog', () => {
  test('joins the structured result with the ids of BUSINESS_RULES.md and groups look-alikes', () => {
    const catalog = ruleCatalog(JSON.stringify(RESULT), RULES_MD, null)
    expect(catalog.source).toBe('result')
    expect(catalog.rules.map(rule => [rule.id, rule.status, rule.duplicateGroup])).toEqual([
      ['RULE-001', 'confirmed', 1],
      ['RULE-002', 'confirmed', 1],
      ['RULE-003', 'confirmed', undefined],
      ['RULE-004', 'confirmed', undefined],
      [expect.stringMatching(/^R-[0-9a-f]{6}$/), 'refuted', undefined],
    ])
    expect(catalog.rules[2]).toMatchObject({ smeQuestion: 'Is it 30 or 31?', citations: [{ path: 'src/A.java', from: 19, to: 19 }] })
    expect(catalog.rules[4]?.rejectionReason).toBe('refuted: no constraint')
    expect(catalog.dataObjects).toEqual([{ name: 'Account', source: 'src/Account.java:5', fields: [{ name: 'id', type: 'String' }], consumedBy: ['Late fee applies after 30 days'] }])
    expect(catalog.stats).toEqual({ confirmed: 4, rejected: 1, p0: 3 })
    expect(catalog.skippedPhases).toEqual(['round 2 skipped'])
  })

  test('falls back to BUSINESS_RULES.md and DATA_OBJECTS.md without a result', () => {
    const catalog = ruleCatalog(null, RULES_MD, '# Data Objects\n\n## Account\nSource: `src/Account.java:5`\n\n| Field | Type | Note |\n|---|---|---|\n| id | String | key |\n\nUsed by: Rule one, Rule two\n')
    expect(catalog.source).toBe('markdown')
    expect(catalog.rules.map(rule => [rule.id, rule.priority, rule.source])).toEqual([
      ['RULE-001', 'P0', 'src/A.java:15-17'],
      ['RULE-002', 'P0', 'src/A.java:18'],
      ['RULE-003', 'P0', 'src/A.java:19'],
      ['RULE-004', 'P1', 'src/R.java:20'],
    ])
    expect(catalog.rules[0]?.plainEnglish).toBe('Interest is a twelfth of the yearly rate.')
    expect(catalog.dataObjects).toEqual([{ name: 'Account', source: 'src/Account.java:5', fields: [{ name: 'id', type: 'String', note: 'key' }], consumedBy: ['Rule one', 'Rule two'] }])
  })

  test('an unreadable result and no markdown is an empty catalog', () => {
    expect(ruleCatalog('{', null, null)).toEqual({ rules: [], dataObjects: [], stats: {}, skippedPhases: [], source: 'none' })
    expect(parseDataObjects('no sections')).toEqual([])
  })
})

const FINDINGS_MD = `# Security Findings — billing

## Scorecard

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |
| **Total** | **2** |

**Top CWE categories:** CWE-89, CWE-862

**Refuted as false positives:** 3 findings.

## Coverage gaps

- **injection**: not scanned
- SEC-009 Path traversal (CWE-22) \`src/F.java:4\`: not judged

## Findings by severity

| ID | Title | Severity | CWE | Location |
|---|---|---|---|---|
| SEC-001 | SQL built by concatenation | High | CWE-89 | \`src/R.java:16-18\` |
| SEC-002 | No authorization on find | Medium | CWE-862 | \`src/R.java:20\` |

## Dependency CVE table

| Package | Installed version | CVE | Fixed version |
|---|---|---|---|
| — | — | — | — |

## Credential inventory

2 hardcoded credentials found — inventory in the restricted portal record (not committed; not for sharing).
`

describe('security findings', () => {
  test('reads the scorecard, findings, refuted count and coverage gaps', () => {
    const report = parseSecurityFindings(FINDINGS_MD)
    expect(report.scorecard).toEqual({ Critical: 0, High: 1, Medium: 1, Low: 0, Info: 0, total: 2 })
    expect(report.scorecardStated).toBe(true)
    expect(report.topCwes).toBe('CWE-89, CWE-862')
    expect(report.refutedCount).toBe(3)
    expect(report.coverageComplete).toBe(false)
    expect(report.coverageGaps).toEqual(['injection: not scanned', 'SEC-009 Path traversal (CWE-22) `src/F.java:4`: not judged'])
    expect(report.findings.map(finding => [finding.id, finding.severity, finding.cwe, finding.status, finding.citations[0]?.from])).toEqual([
      ['SEC-001', 'High', 'CWE-89', 'confirmed', 16],
      ['SEC-002', 'Medium', 'CWE-862', 'confirmed', 20],
    ])
    expect(report.cves).toBeNull()
    expect(report.credentials).toMatch(/^2 hardcoded credentials/)
  })

  test('reads finding cards and counts the scorecard when the document gives none', () => {
    const report = parseSecurityFindings('# Findings\n\n## Findings by severity\n\n### SEC-001 · Hardcoded password (High)\n**Severity:** High\n**CWE:** CWE-798\n**Location:** `config/db.yml:12`\n\nThe password is in the file.\n\n## Coverage gaps\n\nAll 5 finder classes returned and every finding was judged.\n')
    expect(report.findings).toEqual([
      { id: 'SEC-001', title: 'Hardcoded password', severity: 'High', cwe: 'CWE-798', location: '`config/db.yml:12`', citations: [{ path: 'config/db.yml', base: 'db.yml', from: 12, to: 12 }], status: 'confirmed', detail: 'The password is in the file.' },
    ])
    expect(report.scorecard).toMatchObject({ High: 1, total: 1 })
    expect(report.scorecardStated).toBe(false)
    expect(report.coverageComplete).toBe(true)
  })

  test('reads confidence, review coverage, the assessment carry-over and the tools not run', () => {
    const report = parseSecurityFindings(`# Security Findings — billing

## Scorecard

| Severity | Count |
|---|---|
| Medium | 1 |
| Low | 1 |
| **Total** | **2** |

**Review coverage:** manual review of 6 files (\`src/billing/AccountRepository.java\`, …); no SAST, dependency-audit or secret-scanning tool ran.

## Coverage gaps

All 5 finder classes returned and every finding was judged.

## Findings by severity

| ID | CWE | Severity | Confidence | Location | Title |
|---|---|---|---|---|---|
| SEC-001 | CWE-862 | Medium | Low | \`src/billing/AccountRepository.java:16-22\` | No authorization on find |
| SEC-002 | CWE-209 | Low | Medium | \`src/billing/AccountRepository.java:20\` | Account id echoed in the error |

### SEC-003 · Unpinned JDBC driver
**Severity:** Low
**Confidence:** Low
**CWE:** CWE-1104

The driver is supplied at deploy time.

## Assessment carry-over

| Assessment ID | Title | Location | Severity | Outcome | Reason |
|---|---|---|---|---|---|
| SEC-001 | Missing authorization | \`src/billing/AccountRepository.java:16-22\` | Medium | Confirmed as SEC-001 | find() has no ownership check |
| SEC-004 | Negative DAYS_OVERDUE waives the fee | \`src/billing/InvoiceService.java:18\` | Low | Refuted | a data-quality rule, not an attacker-reachable flaw |

## Audit tools not run

| Tool | Reason |
|---|---|
| OWASP Dependency-Check | no shell or network in a runtime job; no build manifest to resolve |
`)
    expect(report.findings.map(finding => [finding.id, finding.severity, finding.confidence, finding.status])).toEqual([
      ['SEC-001', 'Medium', 'Low', 'confirmed'],
      ['SEC-002', 'Low', 'Medium', 'confirmed'],
      ['SEC-003', 'Low', 'Low', 'confirmed'],
    ])
    expect(report.findings[0]?.detail).toBeUndefined()
    expect(report.reviewCoverage).toMatch(/^manual review of 6 files/)
    expect(report.carryOver?.rows.map(row => row[4])).toEqual(['Confirmed as SEC-001', 'Refuted'])
    expect(report.toolsNotRun?.rows).toEqual([['OWASP Dependency-Check', 'no shell or network in a runtime job; no build manifest to resolve']])
    expect(report.carryOverItems).toEqual([
      { id: 'SEC-001', highlight: 'Missing authorization', location: '`src/billing/AccountRepository.java:16-22`', severity: 'Medium', verdict: 'confirmed', findingId: 'SEC-001', reason: 'find() has no ownership check' },
      { id: 'SEC-004', highlight: 'Negative DAYS_OVERDUE waives the fee', location: '`src/billing/InvoiceService.java:18`', severity: 'Low', verdict: 'refuted', reason: 'a data-quality rule, not an attacker-reachable flaw' },
    ])
    expect(report.toolsNotRunItems).toEqual([{ tool: 'OWASP Dependency-Check', reason: 'no shell or network in a runtime job; no build manifest to resolve' }])
    expect(report.coverageComplete).toBe(true)
  })

  test('an empty findings table with a dash row is no finding, and older documents have no carry-over', () => {
    const report = parseSecurityFindings('# F\n\n## Findings by severity\n\n| ID | Severity | Title |\n|---|---|---|\n| — | — | — |\n')
    expect(report.findings).toEqual([])
    expect(report.carryOver).toBeNull()
    expect(report.reviewCoverage).toBeUndefined()
    expect(report.carryOverItems).toEqual([])
    expect(report.toolsNotRunItems).toEqual([])
  })

  test('reads every carry-over verdict and the finding a highlight became', () => {
    const report = parseSecurityFindings(`# F

## Assessment carry-over

| Highlight | Finding | Verdict | Reason |
|---|---|---|---|
| Hardcoded password | SEC-002 | Confirmed | literal in DbConfig |
| Open redirect | — | Not judged | the refuter returned nothing |
| Weak hash | SEC-009 | Refuted | used for cache keys only |
`)
    expect(report.carryOverItems.map(item => [item.highlight, item.verdict, item.findingId])).toEqual([
      ['Hardcoded password', 'confirmed', 'SEC-002'],
      ['Open redirect', 'not judged', undefined],
      ['Weak hash', 'refuted', 'SEC-009'],
    ])
    expect(report.findings).toEqual([])
  })

  test('summarises a remediation patch', () => {
    expect(patchSummary('# SEC-001: parameterize\n--- a/src/R.java\n+++ b/src/R.java\n@@ -1,2 +1,2 @@\n-a\n+b\n')).toEqual({ hunks: 1, files: ['src/R.java'], findings: ['SEC-001'] })
    expect(patchSummary('# Nothing to patch')).toEqual({ hunks: 0, files: [], findings: [] })
  })
})
