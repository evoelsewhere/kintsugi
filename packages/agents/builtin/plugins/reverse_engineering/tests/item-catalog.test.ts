import { describe, expect, test } from 'vitest'

import { CATALOG_ITEM_ID_PATTERN } from '@kintsugi/domain'

import { ITEM_ID, parseItemCatalog } from '../hooks/reader/item-catalog.js'

// The documents render_catalog.py writes (scripts/catalog_common.py, render_catalog()).
const INDEX = `---
app: "billing"
generatedBy: "reconcile_catalog.py"
sourceRepository: "legacy"
sourceCommit: "${'a'.repeat(40)}"
modules: 2
items: 1
retired: 1
unassigned: 120
---
# Item catalog of billing

## Modules

| Module | Name | Items | Summary |
| --- | --- | --- | --- |
| invoicing | Invoicing | 1 | Bills customers. |
| tax | Tax | 1 |  |
| Bad Module | Bad | 0 |  |

## Ambiguities

What a person should check.

- src/x.cbl is claimed by 2 leaves

## Unassigned files

Inventory files in no item (120 more not listed).

- \`README.md\`
- \`/abs/path\`
`

const INVOICING = `---
module: "invoicing"
name: "Invoicing"
items: 1
---
# Invoicing

Bills customers.

## invoicing/invoice-entry: Invoice entry

Captures invoices.

- **kind:** screen
- **status:** active
- **loc:** 1840
- **complexity:** medium
- **digest:** \`sha256:abc\`
- **aliases:**
  - Invoices

### Leaves

| Leaf | Name | Kind | File | LOC | Entry point |
| --- | --- | --- | --- | --- | --- |
| INV01 | INV01 | screen | src/inv/INV01.cbl | 1840 | yes |

### Depends on

| Item | Kinds | Edges |
| --- | --- | --- |
| tax/tax-calc | call, read | 3 |
| not an item | call | 1 |

### Used by

- \`web/portal\`

### Data stores

| Store | Access |
| --- | --- |
| ds:INVOICES | write |

### Parts

| Part | Kind | File |
| --- | --- | --- |
| calcTax | function | src/inv/INV01.cbl:210 |
|  | no name |  |

### Files

- \`src/inv/INV01.cbl\`
- \`../etc/passwd\`
- \`src/./inv/INV02.cbl\`

## no-module-separator: dropped

- **kind:** screen

## invoicing/invoice-entry: duplicate

- **kind:** api
`

const TAX = `---
module: "tax"
name: "Tax"
items: 1
---
# Tax

## tax/tax-calc: Tax

- **kind:** batch-job
- **status:** retired
- **complexity:** extreme
`

describe('item catalog reader', () => {
  test('reads items, modules, coverage and ambiguities defensively', () => {
    const catalog = parseItemCatalog(INDEX, { invoicing: INVOICING, tax: TAX })!
    expect(catalog.app).toBe('billing')
    expect(catalog.source).toEqual({ repo: 'legacy', commit: 'a'.repeat(40) })
    expect(catalog.items.map(item => item.id)).toEqual(['invoicing/invoice-entry', 'tax/tax-calc'])
    const [entry, tax] = catalog.items
    expect(entry).toMatchObject({ module: 'invoicing', kind: 'screen', name: 'Invoice entry', summary: 'Captures invoices.', loc: 1840, complexity: 'medium', status: 'active', aliases: ['Invoices'], digest: 'sha256:abc' })
    expect(entry?.files).toEqual(['src/inv/INV01.cbl', 'src/inv/INV02.cbl'])
    expect(entry?.leaves).toEqual(['INV01'])
    expect(entry?.entryPoints).toEqual(['INV01'])
    expect(entry?.parts).toEqual([{ name: 'calcTax', kind: 'function', file: 'src/inv/INV01.cbl:210' }])
    expect(entry?.dependsOn).toEqual([{ item: 'tax/tax-calc', kinds: ['call', 'read'], edges: 3 }])
    expect(entry?.usedBy).toEqual(['web/portal'])
    expect(entry?.dataStores).toEqual([{ id: 'ds:INVOICES', access: ['write'] }])
    expect(tax).toMatchObject({ files: [], complexity: 'low', status: 'retired', summary: '', loc: 0, dependsOn: [] })
    // The invalid module is dropped.
    expect(catalog.modules.map(module => [module.id, module.summary])).toEqual([
      ['invoicing', 'Bills customers.'],
      ['tax', ''],
    ])
    expect(catalog.unassigned).toEqual(['README.md'])
    expect(catalog.unassignedCount).toBe(120)
    expect(catalog.ambiguities).toEqual(['src/x.cbl is claimed by 2 leaves'])
  })

  test('a module without a document has no items', () => {
    expect(parseItemCatalog(INDEX, { invoicing: INVOICING })!.items.map(item => item.id)).toEqual(['invoicing/invoice-entry'])
  })

  test('returns null for text that is not a catalog', () => {
    expect(parseItemCatalog('not a catalog', {})).toBeNull()
    expect(parseItemCatalog('# Item catalog\n', {})).toBeNull()
    expect(parseItemCatalog('', {})).toBeNull()
  })

  test('the reader and the domain agree on what an item id is', () => {
    expect(ITEM_ID.source).toBe(CATALOG_ITEM_ID_PATTERN.source)
  })
})
