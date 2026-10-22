import { cardsOf, countOf, documentOf, fieldList, fieldText, itemsOf, recordsOf, sectionText, textOf } from './document.js'
import { sectionsOf, tablesIn } from './markdown.js'
import { resolveDots } from './paths.js'

/**
 * The item catalog of the assess stage (ADR-0033, ADR-0042): `01-legacy/_catalog/index.md` (the modules, the
 * ambiguities, the unassigned files) and one `01-legacy/_catalog/<module>.md` per module with a card per item
 * (`scripts/render_catalog.py` writes them from the curated catalog and the extracted topology). A card holds
 * the item's facts, its leaves, the items it depends on and that use it, the data stores it touches, its parts
 * and its files. Every field is still read as optional and of unknown shape: an item without a valid id is
 * dropped, a duplicate id is dropped, lists that are not lists are empty, never thrown on. Lists are capped so
 * a hostile file cannot grow the payload.
 *
 * The id pattern equals `CATALOG_ITEM_ID_PATTERN` of `@kintsugi/domain` (checked by a test; the
 * reader has no dependencies).
 */

export type ItemCatalogPart = { name: string; kind?: string; file?: string }

export type ItemCatalogModule = { id: string; name: string; summary: string }

/** The calls from one item into another, counted over the leaves' edges. */
export type ItemCatalogDependency = { item: string; kinds: string[]; edges: number }

export type ItemCatalogItem = {
  /** `<module>/<item>`. */
  id: string
  module: string
  kind: string
  name: string
  summary: string
  files: string[]
  leaves: string[]
  entryPoints: string[]
  loc: number
  complexity: 'low' | 'medium' | 'high'
  digest: string
  status: 'active' | 'retired'
  aliases: string[]
  parts: ItemCatalogPart[]
  dependsOn: ItemCatalogDependency[]
  usedBy: string[]
  dataStores: { id: string; access: string[] }[]
}

export type ItemCatalog = {
  app: string
  source: { repo?: string; commit?: string }
  modules: ItemCatalogModule[]
  items: ItemCatalogItem[]
  /** The unassigned files the index lists (the first ones); `unassignedCount` counts them all. */
  unassigned: string[]
  unassignedCount: number
  ambiguities: string[]
}

/** `<module>/<item>`, two kebab-case segments. */
export const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_ITEMS = 5_000
const MAX_FILES = 25_000
const MAX_LIST = 2_000
const MAX_PARTS = 100

/** A repository-relative path without `..`, or undefined. */
const relativePath = (value: string): string | undefined => {
  const path = textOf(value, 500)
  if (path === undefined || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined
  const clean = resolveDots(path)
  return clean === '' || clean.startsWith('..') ? undefined : clean
}

const paths = (values: string[], max = MAX_FILES): string[] => values.slice(0, max).flatMap(value => relativePath(value) ?? [])

const csv = (value: string | undefined): string[] => (value ?? '').split(',').map(part => part.trim()).filter(Boolean)

function itemsOfModule(module: string, text: string): ItemCatalogItem[] {
  const { body } = documentOf(text)

  return cardsOf(body, 2).flatMap(card => {
    if (!ITEM_ID.test(card.id)) return []

    const complexity = fieldText(card, 'complexity')
    const leaves = recordsOf(tablesIn(sectionText(card, 'Leaves'))[0])
    const parts = recordsOf(tablesIn(sectionText(card, 'Parts'))[0])

    return [
      {
        id: card.id,
        module,
        kind: fieldText(card, 'kind', 60) ?? 'module',
        name: textOf(card.title, 200) ?? card.id,
        summary: textOf(card.prose, 2000) ?? '',
        files: paths(itemsOf(sectionText(card, 'Files'))),
        leaves: leaves.map(row => row.leaf ?? '').filter(Boolean).slice(0, MAX_LIST),
        entryPoints: leaves.filter(row => row['entry point']?.toLowerCase() === 'yes').map(row => row.leaf ?? '').filter(Boolean),
        loc: countOf(fieldText(card, 'loc')),
        complexity: complexity === 'medium' || complexity === 'high' ? complexity : 'low',
        digest: fieldText(card, 'digest', 80) ?? '',
        status: fieldText(card, 'status') === 'retired' ? 'retired' : 'active',
        aliases: fieldList(card, 'aliases', 50, 200),
        parts: parts.slice(0, MAX_PARTS).flatMap(row => {
          const name = textOf(row.part, 200)
          if (name === undefined) return []
          const kind = textOf(row.kind, 60)
          const file = textOf(row.file, 500)
          return [{ name, ...(kind === undefined ? {} : { kind }), ...(file === undefined ? {} : { file }) }]
        }),
        dependsOn: recordsOf(tablesIn(sectionText(card, 'Depends on'))[0]).flatMap(row => (ITEM_ID.test(row.item ?? '') ? [{ item: row.item ?? '', kinds: csv(row.kinds), edges: countOf(row.edges) || 1 }] : [])),
        usedBy: itemsOf(sectionText(card, 'Used by')).filter(id => ITEM_ID.test(id)),
        dataStores: recordsOf(tablesIn(sectionText(card, 'Data stores'))[0]).flatMap(row => (row.store ? [{ id: row.store, access: csv(row.access) }] : [])),
      },
    ]
  })
}

/**
 * Parses the catalog from its index and its module documents (by module id); null when the index is not a
 * catalog (no `app` and no modules table). A module without a document has no items.
 */
export function parseItemCatalog(indexText: string, moduleTexts: Readonly<Record<string, string>>): ItemCatalog | null {
  const { data, body } = documentOf(indexText)
  const sections = sectionsOf(body)
  const under = (title: string): string => sections.find(section => section.level === 2 && section.title === title)?.body ?? ''
  const moduleRows = recordsOf(tablesIn(under('Modules'))[0])

  if (textOf(data.app) === undefined && moduleRows.length === 0) return null

  const modules = new Map<string, ItemCatalogModule>()

  for (const row of moduleRows.slice(0, MAX_LIST)) {
    const id = row.module ?? ''
    if (!SEGMENT.test(id) || modules.has(id)) continue
    modules.set(id, { id, name: textOf(row.name, 200) ?? id, summary: textOf(row.summary, 2000) ?? '' })
  }

  const seen = new Set<string>()
  const items = [...modules.keys()].flatMap(module => itemsOfModule(module, moduleTexts[module] ?? '')).slice(0, MAX_ITEMS).filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const repo = textOf(data.sourceRepository)
  const commit = textOf(data.sourceCommit, 80)

  return {
    app: textOf(data.app) ?? '',
    source: { ...(repo === undefined ? {} : { repo }), ...(commit === undefined ? {} : { commit }) },
    modules: [...modules.values()],
    items,
    unassigned: paths(itemsOf(under('Unassigned files'))),
    unassignedCount: countOf(data.unassigned),
    ambiguities: itemsOf(under('Ambiguities')).slice(0, 500),
  }
}
