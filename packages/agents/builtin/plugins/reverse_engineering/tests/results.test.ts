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

const INVENTORY_MD = `---
app: "billing"
sourceRepository: "legacy"
sourceCommit: "${'a'.repeat(40)}"
method: "static inventory"
complexityIndexFormula: "2.94 × KSLOC^1.10"
fileCount: 3
sourceFileCount: 2
totalBytes: 1000
totalLines: 36
sloc: 30
ksloc: 0.03
complexity: 3
complexityPerKsloc: 100
complexityIndex: 0.11
directoryDepth: 1
codeFiles: 2
medianSloc: 15
halfComplexityFiles: 1
topTenShare: 1
oversized: 0
---
# Inventory of billing

## Languages

| Language | Files | Lines | SLOC | Complexity |
| --- | --- | --- | --- | --- |
| SQL | 1 | 6 | 6 | 0 |
| Java | 1 | 30 | 24 | 3 |

## Directories

| Path | Files | SLOC | Complexity |
| --- | --- | --- | --- |
| (root) | 2 | 30 | 3 |

## Size distribution

| SLOC per file | Files |
| --- | --- |
| <50 | 2 |
| 50-99 | 0 |

## Most complex files

| Path | Language | Lines | SLOC | Complexity |
| --- | --- | --- | --- | --- |
| A.java | Java | 30 | 24 | 3 |
| .git | Other | 1 | 1 | 9 |
| schema.sql | SQL | 6 | 6 | 0 |
`

describe('inventory', () => {
  test('reads the figures of record, the roll-ups and the most complex files, without the .git pointer', () => {
    const inventory = parseInventory(INVENTORY_MD)
    expect(inventory).toMatchObject({ app: 'billing', sourceCommit: 'a'.repeat(40), fileCount: 3, sourceFileCount: 2, sloc: 30, ksloc: 0.03, complexityIndex: 0.11, complexityPerKsloc: 100, directoryDepth: 1 })
    expect(inventory?.files.map(file => [file.path, file.sloc, file.complexity])).toEqual([
      ['A.java', 24, 3],
      ['schema.sql', 6, 0],
    ])
    expect(inventory?.languages).toEqual([
      { language: 'Java', files: 1, lines: 30, sloc: 24, complexity: 3 },
      { language: 'SQL', files: 1, lines: 6, sloc: 6, complexity: 0 },
    ])
    expect(inventory?.directories).toEqual([{ path: '(root)', files: 2, sloc: 30, complexity: 3 }])
    expect(inventory?.sizeDistribution).toEqual([
      { label: '<50', files: 2 },
      { label: '50-99', files: 0 },
    ])
    expect(inventory?.signals).toEqual({ codeFiles: 2, medianSloc: 15, halfComplexityFiles: 1, topTenShare: 1, oversized: 0 })
  })

  test('is null for text that is not an inventory', () => {
    expect(parseInventory('not an inventory')).toBeNull()
    expect(parseInventory('')).toBeNull()
    expect(parseInventory('---\napp: "x"\n---\n# Nothing')).toBeNull()
  })
})

const TOPOLOGY_MD = `---
app: "billing"
system: "Billing"
domains: 2
leaves: 3
dataStores: 1
edges: 3
entryPoints: 1
deadEnds: 1
flows: 1
truncated: false
---
# Topology of Billing

## Domains

| Domain | Leaves | Data stores | LOC |
| --- | --- | --- | --- |
| A | 2 | 1 | 13 |
| B | 1 | 0 | 5 |

## Edges between domains

| From | To | Kinds | Edges |
| --- | --- | --- | --- |
| A | B | call | 1 |

## Leaves

| Leaf | Name | Kind | Domain | File | LOC | Entry point | Dead end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m1 | M1 | module | A | src/a.java | 8 | yes |  |
| m2 | M2 | module | A | src/b.java | 5 |  | yes |
| m3 | M3 | module | B | src/c.java | 5 |  |  |
| ds:acct | Accounts | datastore | A |  |  |  |  |

## Edges

| Source | Target | Kind |
| --- | --- | --- |
| m1 | m3 | call |
| m1 | ds:acct | write |

## Observations

- Coupling between A and B.

## Flows

### Open an account

- **persona:** clerk
- **description:** Plain words.

| Step | Nodes |
| --- | --- |
| Enter the form | m1, m2 |
`

describe('topology', () => {
  test('reads the leaves with their domains, the edges, the flows and the observations', () => {
    const topology = parseTopology(TOPOLOGY_MD)
    expect(topology?.system).toBe('Billing')
    expect(topology?.nodes[0]).toMatchObject({ id: 'm1', domain: 'A', loc: 8, file: 'src/a.java' })
    expect(topology?.modules.map(node => node.id)).toEqual(['m1', 'm2', 'm3'])
    expect(topology?.domains.map(domain => [domain.name, domain.modules.map(node => node.id)])).toEqual([
      ['A', ['m1', 'm2']],
      ['B', ['m3']],
    ])
    expect(topology?.edges).toEqual([
      { source: 'm1', target: 'm3', kind: 'call' },
      { source: 'm1', target: 'ds:acct', kind: 'write' },
    ])
    expect(topology?.domainEdges).toEqual([{ from: 'A', to: 'B', kinds: ['call'], edges: 1 }])
    expect([...(topology?.entryPoints ?? [])]).toEqual(['m1'])
    expect([...(topology?.deadEnds ?? [])]).toEqual(['m2'])
    expect(topology?.flows).toEqual([{ name: 'Open an account', persona: 'clerk', description: 'Plain words.', steps: [{ label: 'Enter the form', nodes: ['m1', 'm2'] }] }])
    expect(topology?.observations).toEqual(['Coupling between A and B.'])
    expect(topology?.totals).toEqual({ leaves: 3, dataStores: 1, edges: 3, entryPoints: 1, deadEnds: 1, truncated: false })
    expect(topology?.byFileBase.get('a.java')?.[0]?.id).toBe('m1')
  })

  test('is null for text with no leaves', () => {
    expect(parseTopology('# nothing')).toBeNull()
    expect(parseTopology('---\nsystem: "x"\n---\n## Domains\n')).toBeNull()
  })
})

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
  test('reads the rule cards of a rules document and groups look-alikes', () => {
    const catalog = ruleCatalog(RULES_MD, null)
    expect(catalog.source).toBe('markdown')
    expect(catalog.rules.map(rule => [rule.id, rule.status, rule.priority, rule.source, rule.duplicateGroup])).toEqual([
      ['RULE-001', 'confirmed', 'P0', 'src/A.java:15-17', 1],
      ['RULE-002', 'confirmed', 'P0', 'src/A.java:18', 1],
      ['RULE-003', 'confirmed', 'P0', 'src/A.java:19', undefined],
      ['RULE-004', 'confirmed', 'P1', 'src/R.java:20', undefined],
    ])
    expect(catalog.rules[0]?.plainEnglish).toBe('Interest is a twelfth of the yearly rate.')
    expect(catalog.rules[2]).toMatchObject({ citations: [{ path: 'src/A.java', from: 19, to: 19 }] })
  })

  test('reads the data objects document', () => {
    const catalog = ruleCatalog(RULES_MD, '# Data Objects\n\n## Account\nSource: `src/Account.java:5`\n\n| Field | Type | Note |\n|---|---|---|\n| id | String | key |\n\nUsed by: Rule one, Rule two\n')
    expect(catalog.dataObjects).toEqual([{ name: 'Account', source: 'src/Account.java:5', fields: [{ name: 'id', type: 'String', note: 'key' }], consumedBy: ['Rule one', 'Rule two'] }])
  })

  test('a unit rules document with front matter reads like the catalog', () => {
    const unit = `---\napp: "billing"\nitem: "tax/calc"\nrules: 1\n---\n# Business rules - tax/calc\n\n| ID | Name |\n|---|---|\n| RULE-tax.calc-1a2b3c4d | Round |\n\n## Calculation\n\n### RULE-tax.calc-1a2b3c4d: Round\n**Category:** Calculation\n**Priority:** P0\n**Source:** \`src/TAX.cbl:3\`\n`
    expect(ruleCatalog(unit, null).rules.map(rule => [rule.id, rule.name, rule.priority])).toEqual([['RULE-tax.calc-1a2b3c4d', 'Round', 'P0']])
  })

  test('a rules index lists the rules and links their files; retired rules are not rules', () => {
    const index = [
      '---\napp: "billing"\nrules: 2\n---',
      '# Business rules - tax/calc',
      '',
      '| ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| RULE-tax.calc-1a2b3c4d | Round | Calculation | P0 | High | 3 | confirmed | `src/TAX.cbl:3-9` | [RULE-tax.calc-1a2b3c4d](rules/RULE-tax.calc-1a2b3c4d.md) |',
      '| RULE-tax.calc-2b3c4d5e | Floor | Validation | P1 | Low | 1 | needs-sme | `src/TAX.cbl:20` | [RULE-tax.calc-2b3c4d5e](rules/RULE-tax.calc-2b3c4d5e.md) |',
      '',
      '## Retired rules',
      '',
      '| ID | Name | Last version | Retired | Rule file |',
      '| --- | --- | --- | --- | --- |',
      '| RULE-tax.calc-3c4d5e6f | Gone | 2 | 2026-10-22 | [RULE-tax.calc-3c4d5e6f](rules/RULE-tax.calc-3c4d5e6f.md) |',
      '',
    ].join('\n')
    const rules = ruleCatalog(index, null).rules

    expect(rules.map(rule => [rule.id, rule.name, rule.category, rule.priority, rule.confidence, rule.source, rule.version, rule.ruleStatus, rule.file])).toEqual([
      ['RULE-tax.calc-1a2b3c4d', 'Round', 'Calculation', 'P0', 'High', 'src/TAX.cbl:3-9', 3, 'confirmed', 'rules/RULE-tax.calc-1a2b3c4d.md'],
      ['RULE-tax.calc-2b3c4d5e', 'Floor', 'Validation', 'P1', 'Low', 'src/TAX.cbl:20', 1, 'needs-sme', 'rules/RULE-tax.calc-2b3c4d5e.md'],
    ])
    expect(rules[1]?.smeQuestion).toBeDefined()
    expect(rules[0]?.smeQuestion).toBeUndefined()
  })

  test('no document is an empty catalog', () => {
    expect(ruleCatalog(null, null)).toEqual({ rules: [], dataObjects: [], source: 'none' })
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
