import { linesOf } from './text.js'

/**
 * Unit state files (ADR-0012), read from the path returned by `unitStatePath`: YAML frontmatter that is the unit's
 * state, then a body. This reader understands the subset the unit files use — `key: value` lines
 * whose value is a JSON scalar or list (what finish_items.py writes) or a plain word, and one
 * level of nesting (`links:` with indented `key: value` lines, `source:` with `- ` items) — and
 * keeps whatever else as text. Nothing here throws on a malformed file.
 */

export type Frontmatter = { data: Record<string, unknown>; body: string }

const MAX_FRONTMATTER_LINES = 400

const scalar = (text: string): unknown => {
  const value = text.trim()
  if (value === '') return null
  if (/^["[{]|^-?\d|^(true|false|null)$/.test(value)) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      // not JSON (a YAML flow map such as `{repo: legacy, paths: [...]}`): kept as text
    }
  }
  return value.replace(/^'(.*)'$/, '$1')
}

/** The frontmatter of a Markdown file; null when it has none. */
export function frontmatterOf(text: string): Frontmatter | null {
  const lines = linesOf(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0 || end > MAX_FRONTMATTER_LINES) return null

  const data: Record<string, unknown> = {}
  let parent: string | undefined
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const nested = /^\s+/.test(line)
    if (nested && parent !== undefined) {
      const item = /^\s+-\s+(.*)$/.exec(line)
      const pair = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
      const current = data[parent]
      if (item !== null) data[parent] = [...(Array.isArray(current) ? current : []), scalar(item[1] ?? '')]
      else if (pair !== null) data[parent] = { ...(typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}), [pair[1] ?? '']: scalar(pair[2] ?? '') }
      continue
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (pair === null) {
      parent = undefined
      continue
    }
    const key = pair[1] ?? ''
    const value = scalar(pair[2] ?? '')
    data[key] = value
    parent = value === null ? key : undefined
  }
  return { data, body: lines.slice(end + 1).join('\n').trim() }
}

export type WorkItemSummary = {
  id?: string
  status?: string
  title?: string
  module?: string
  kind?: string
  phase?: string
  stage?: string
  complexity?: string
  assignee?: string
  dependsOn: string[]
  links: { asIs?: string; businessRules: string[] }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 300) : undefined)

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim().slice(0, 300)] : [])).slice(0, 500) : []

/** The fields of a unit file a results view shows; null when the file has no frontmatter. */
export function parseWorkItem(markdown: string): WorkItemSummary | null {
  const document = frontmatterOf(markdown)
  if (document === null) return null
  const { data } = document
  const links = typeof data.links === 'object' && data.links !== null && !Array.isArray(data.links) ? (data.links as Record<string, unknown>) : {}
  const summary: WorkItemSummary = { dependsOn: texts(data.dependsOn), links: { businessRules: texts(links.businessRules) } }
  const asIs = text(links.asIs)
  if (asIs !== undefined) summary.links.asIs = asIs
  for (const field of ['id', 'status', 'title', 'module', 'kind', 'phase', 'stage', 'complexity', 'assignee'] as const) {
    const value = text(data[field])
    if (value !== undefined) summary[field] = value
  }
  return summary
}
