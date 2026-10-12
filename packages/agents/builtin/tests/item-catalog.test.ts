import { describe, expect, test } from 'vitest'

import { parseItemCatalog } from '../hooks/reader/item-catalog.js'

// The shape reconcile_catalog.py writes (scripts/catalog_common.py).
const CATALOG = {
  schemaVersion: 1,
  app: 'billing',
  generatedBy: 'reconcile_catalog.py',
  source: { repo: 'legacy', commit: 'a'.repeat(40) },
  modules: [{ id: 'invoicing', name: 'Invoicing', summary: 'Bills customers.' }, { id: 'Bad Module' }],
  items: [
    {
      id: 'invoicing/invoice-entry',
      module: 'invoicing',
      kind: 'screen',
      name: 'Invoice entry',
      summary: 'Captures invoices.',
      files: ['src/inv/INV01.cbl', '../etc/passwd', 'src/./inv/INV02.cbl'],
      leaves: ['INV01'],
      entryPoints: ['INV01'],
      loc: 1840,
      complexity: 'medium',
      digest: 'sha256:abc',
      status: 'active',
      aliases: ['Invoices'],
      parts: [{ name: 'calcTax', kind: 'function', file: 'src/inv/INV01.cbl:210' }, { kind: 'no name' }],
    },
    { id: 'tax/tax-calc', module: 'tax', kind: 'batch-job', name: 'Tax', files: 'not a list', complexity: 'extreme', status: 'retired' },
    { id: 'no-module-separator', name: 'dropped' },
    { id: 'invoicing/invoice-entry', name: 'duplicate' },
  ],
  unassigned: ['README.md', '/abs/path'],
  ambiguities: ['src/x.cbl is claimed by 2 leaves'],
}

describe('item catalog reader', () => {
  test('reads items, modules, coverage and ambiguities defensively', () => {
    const catalog = parseItemCatalog(JSON.stringify(CATALOG))!
    expect(catalog.app).toBe('billing')
    expect(catalog.source).toEqual({ repo: 'legacy', commit: 'a'.repeat(40) })
    expect(catalog.items.map(item => item.id)).toEqual(['invoicing/invoice-entry', 'tax/tax-calc'])
    const [entry, tax] = catalog.items
    expect(entry).toMatchObject({ kind: 'screen', loc: 1840, complexity: 'medium', status: 'active', aliases: ['Invoices'] })
    expect(entry?.files).toEqual(['src/inv/INV01.cbl', 'src/inv/INV02.cbl'])
    expect(entry?.parts).toEqual([{ name: 'calcTax', kind: 'function', file: 'src/inv/INV01.cbl:210' }])
    expect(tax).toMatchObject({ files: [], complexity: 'low', status: 'retired', summary: '', loc: 0 })
    // The invalid module is dropped; the module of an item that the file did not list is added.
    expect(catalog.modules.map(module => module.id)).toEqual(['invoicing', 'tax'])
    expect(catalog.unassigned).toEqual(['README.md'])
    expect(catalog.ambiguities).toHaveLength(1)
  })

  test('returns null for text that is not a catalog', () => {
    expect(parseItemCatalog('not json')).toBeNull()
    expect(parseItemCatalog('{"modules": []}')).toBeNull()
    expect(parseItemCatalog('[]')).toBeNull()
  })
})
