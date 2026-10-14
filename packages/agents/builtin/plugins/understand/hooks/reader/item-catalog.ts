import { resolveDots } from './paths.js'

/**
 * `assessment/<app>/catalog.json` of the assess stage (ADR-0033): the application's items,
 * module → item, written by reconcile_catalog.py from a topology the model-written extraction
 * script produced and an agent's curation edits. Every field is still read as optional and of
 * unknown shape: an item without a valid id is dropped, a duplicate id is dropped, lists that are
 * not lists are empty, never thrown on. Lists are capped so a hostile file cannot grow the payload.
 *
 * The id pattern equals `CATALOG_ITEM_ID_PATTERN` of `@kintsugi/domain` (checked by a test; the
 * reader has no dependencies).
 */

export type ItemCatalogPart = { name: string; kind?: string; file?: string }

export type ItemCatalogModule = { id: string; name: string; summary: string }

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
}

export type ItemCatalog = {
  schemaVersion: number
  app: string
  source: { repo?: string; commit?: string }
  modules: ItemCatalogModule[]
  items: ItemCatalogItem[]
  unassigned: string[]
  ambiguities: string[]
}

/** `<module>/<item>`, two kebab-case segments. */
export const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_ITEMS = 5_000
const MAX_FILES = 25_000
const MAX_LIST = 2_000
const MAX_PARTS = 100

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, max = 300): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined)

const strings = (value: unknown, max = MAX_LIST, length = 300): string[] =>
  Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim().slice(0, length)] : [])).slice(0, max) : []

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** A repository-relative path without `..`, or undefined. */
const relativePath = (value: unknown): string | undefined => {
  const path = str(value, 500)
  if (path === undefined || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined
  const clean = resolveDots(path)
  return clean === '' || clean.startsWith('..') ? undefined : clean
}

const paths = (value: unknown, max = MAX_FILES): string[] => (Array.isArray(value) ? value.slice(0, max).flatMap(entry => relativePath(entry) ?? []) : [])

function itemOf(raw: unknown): ItemCatalogItem | undefined {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  if (id === undefined || !ITEM_ID.test(id)) return undefined
  const module = str(raw.module)
  const complexity = raw.complexity === 'medium' || raw.complexity === 'high' ? raw.complexity : 'low'
  return {
    id,
    module: module !== undefined && SEGMENT.test(module) ? module : (id.split('/')[0] ?? id),
    kind: str(raw.kind, 60) ?? 'module',
    name: str(raw.name, 200) ?? id,
    summary: str(raw.summary, 2000) ?? '',
    files: paths(raw.files),
    leaves: strings(raw.leaves),
    entryPoints: strings(raw.entryPoints),
    loc: count(raw.loc),
    complexity,
    digest: str(raw.digest, 80) ?? '',
    status: raw.status === 'retired' ? 'retired' : 'active',
    aliases: strings(raw.aliases, 50, 200),
    parts: (Array.isArray(raw.parts) ? raw.parts : []).slice(0, MAX_PARTS).flatMap(part => {
      const name = isRecord(part) ? str(part.name, 200) : undefined
      if (name === undefined || !isRecord(part)) return []
      const kind = str(part.kind, 60)
      const file = str(part.file, 500)
      return [{ name, ...(kind === undefined ? {} : { kind }), ...(file === undefined ? {} : { file }) }]
    }),
  }
}

/** Parses catalog.json; null when the text is not a catalog (not JSON, or no `items` list). */
export function parseItemCatalog(text: string): ItemCatalog | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null

  const seen = new Set<string>()
  const items = raw.items.slice(0, MAX_ITEMS).flatMap(entry => {
    const item = itemOf(entry)
    if (item === undefined || seen.has(item.id)) return []
    seen.add(item.id)
    return [item]
  })
  const modules = new Map<string, ItemCatalogModule>()
  for (const entry of Array.isArray(raw.modules) ? raw.modules.slice(0, MAX_LIST) : []) {
    const id = isRecord(entry) ? str(entry.id) : undefined
    if (id === undefined || !SEGMENT.test(id) || modules.has(id) || !isRecord(entry)) continue
    modules.set(id, { id, name: str(entry.name, 200) ?? id, summary: str(entry.summary, 2000) ?? '' })
  }
  // Every item's module is listed, even when the file forgot it.
  for (const item of items) if (!modules.has(item.module)) modules.set(item.module, { id: item.module, name: item.module, summary: '' })
  const source = isRecord(raw.source) ? raw.source : {}
  const repo = str(source.repo)
  const commit = str(source.commit, 80)

  return {
    schemaVersion: count(raw.schemaVersion) || 1,
    app: str(raw.app) ?? '',
    source: { ...(repo === undefined ? {} : { repo }), ...(commit === undefined ? {} : { commit }) },
    modules: [...modules.values()],
    items,
    unassigned: paths(raw.unassigned),
    ambiguities: strings(raw.ambiguities, 500, 500),
  }
}
