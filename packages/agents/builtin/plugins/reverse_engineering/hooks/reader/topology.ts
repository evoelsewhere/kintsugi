import { cardsOf, countOf, documentOf, fieldText, firstRecords, recordsOf, textOf, itemsOf } from './document.js'
import { sectionsOf, tablesIn } from './markdown.js'
import { baseName, norm } from './paths.js'

/**
 * A topology document: the application's `assessmentTopologyPath` (written by `scripts/render_topology.py` from
 * the extraction script's output) or one unit's `topology.md` (`scripts/scope_items.py`). Front
 * matter with the counts, then the domains, the edges between them, the largest leaves with their entry
 * points and dead ends, the edges between those, the observations and the flows.
 *
 * The file is written by a script from a model-written one, so every field is still read as optional and of
 * unknown shape: anything that does not fit is dropped, never thrown on.
 */

export type TopoNode = {
  id: string
  name: string
  /** `module`, `datastore`, `screen`, or whatever the extraction wrote. */
  kind: string
  /** Lines of code; 0 when the map gave none. */
  loc: number
  /** Source file relative to `source/<app>/`, when the node is one file. */
  file?: string
  /** The name of the domain (first ancestor of kind `domain`) it sits under. */
  domain?: string
  /** The language the map recorded for it, as written (`cobol`, `java`, `php`). */
  language?: string
  /** The node's plain-language paragraph, when one was written. */
  description?: string
}

export type TopoEdge = { source: string; target: string; kind: string }

export type TopoFlow = {
  name: string
  persona?: string
  description?: string
  steps: { label: string; nodes: string[] }[]
}

/** The strongest links between two domains, counted over the leaf-level edges. */
export type TopoDomainEdge = { from: string; to: string; kinds: string[]; edges: number }

export type Topology = {
  system: string
  nodes: TopoNode[]
  /** Nodes that are code (`kind: module`, or any leaf with a file and loc). */
  modules: TopoNode[]
  domains: { name: string; modules: TopoNode[] }[]
  /** The edges between the listed leaves (the document caps them). */
  edges: TopoEdge[]
  domainEdges: TopoDomainEdge[]
  entryPoints: Set<string>
  deadEnds: Set<string>
  flows: TopoFlow[]
  observations: string[]
  /** Totals of the whole topology, which the lists above may be a part of. */
  totals: { leaves: number; dataStores: number; edges: number; entryPoints: number; deadEnds: number; truncated: boolean }
  byId: Map<string, TopoNode>
  /** Lower-cased base name of a node's file, to the nodes that have it. */
  byFileBase: Map<string, TopoNode[]>
}

const named = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value)

/** Parses a topology document; null when the text is not a usable topology. */
export function parseTopology(text: string): Topology | null {
  const { data, body } = documentOf(text)
  const sections = sectionsOf(body)
  const under = (title: string): string => sections.find(section => section.level === 2 && section.title === title)?.body ?? ''

  const entryPoints = new Set<string>()
  const deadEnds = new Set<string>()
  const nodes: TopoNode[] = []

  for (const row of firstRecords(under('Leaves'))) {
    const id = named(row.leaf)

    if (id === undefined) continue

    const file = named(row.file)
    const domain = named(row.domain)

    nodes.push({
      id,
      name: named(row.name) ?? id,
      kind: named(row.kind) ?? 'module',
      loc: countOf(row.loc),
      ...(file !== undefined && { file: norm(file) }),
      ...(domain !== undefined && { domain }),
    })

    if (row['entry point']?.toLowerCase() === 'yes') entryPoints.add(id)
    if (row['dead end']?.toLowerCase() === 'yes') deadEnds.add(id)
  }

  if (nodes.length === 0) {
    return null
  }

  const byId = new Map<string, TopoNode>()

  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }

  const unique = [...byId.values()]
  const modules = unique.filter(node => node.kind === 'module' || (node.file !== undefined && node.loc > 0 && node.kind !== 'datastore'))
  const byDomain = new Map<string, TopoNode[]>()

  for (const node of modules) {
    const key = node.domain ?? 'Other'
    byDomain.set(key, [...(byDomain.get(key) ?? []), node])
  }

  const byFileBase = new Map<string, TopoNode[]>()

  for (const node of unique) {
    if (node.file === undefined) continue

    const key = baseName(node.file).toLowerCase()

    byFileBase.set(key, [...(byFileBase.get(key) ?? []), node])
  }

  const edges: TopoEdge[] = recordsOf(tablesIn(under('Edges'))[0]).flatMap(row =>
    row.source && row.target ? [{ source: row.source, target: row.target, kind: row.kind || 'uses' }] : [],
  )

  const domainEdges: TopoDomainEdge[] = recordsOf(tablesIn(under('Edges between domains'))[0]).flatMap(row =>
    row.from && row.to ? [{ from: row.from, to: row.to, kinds: (row.kinds ?? '').split(',').map(kind => kind.trim()).filter(Boolean), edges: countOf(row.edges) || 1 }] : [],
  )

  return {
    system: textOf(data.system) ?? '',
    nodes: unique,
    modules,
    domains: [...byDomain.entries()].map(([name, members]) => ({ name, modules: members })),
    edges,
    domainEdges,
    entryPoints,
    deadEnds,
    flows: flowsOf(under('Flows')) ?? [],
    observations: itemsOf(under('Observations')),
    totals: {
      leaves: countOf(data.leaves),
      dataStores: countOf(data.dataStores),
      edges: countOf(data.edges),
      entryPoints: countOf(data.entryPoints),
      deadEnds: countOf(data.deadEnds),
      truncated: data.truncated === true,
    },
    byId,
    byFileBase,
  }
}

/** The flows section: a `### name` per flow with persona and description fields, then its steps table. */
function flowsOf(body: string): TopoFlow[] | undefined {
  const parts = sectionsOf(body)
    .filter(section => section.level === 3)
    .map(section => {
      const card = cardsOf(`### ${section.title}\n${section.body}`, 3)[0]
      const persona = card === undefined ? undefined : fieldText(card, 'persona')
      const description = card === undefined ? undefined : fieldText(card, 'description', 400)

      return {
        name: section.title,
        ...(persona !== undefined && { persona }),
        ...(description !== undefined && { description }),
        steps: recordsOf(tablesIn(section.body)[0]).map(row => ({ label: row.step ?? '', nodes: (row.nodes ?? '').split(',').map(node => node.trim()).filter(Boolean) })),
      }
    })

  return parts.length === 0 ? undefined : parts
}

/**
 * The topology node a legacy file belongs to: by its path relative to
 * `source/<app>/` when the map recorded one, else by base name alone.
 */
export function nodeOfFile(topo: Topology, fileRel: string): TopoNode | null {
  const wanted = norm(fileRel)
  const candidates = topo.byFileBase.get(baseName(wanted).toLowerCase()) ?? []

  return (
    candidates.find(node => node.file === wanted) ??
    candidates.find(node => wanted.endsWith(node.file ?? '\0')) ??
    candidates[0] ??
    null
  )
}
