import { frontmatterOf } from './work-item.js'
import { bulletsIn, sectionsOf, tablesIn, type Table } from './markdown.js'
import { linesOf } from './text.js'

/**
 * The shapes the committed documents of the document repository are read by (docs/reference/document-formats.md).
 * The repository holds no JSON: facts are front matter (scalars and short lists), tables (one record per row)
 * and cards (a heading `id: title`, prose, field bullets, subsections). The scripts write them
 * (`scripts/docmd.py` is the counterpart of this module); nothing here throws on a malformed file.
 */

export type Document = { data: Record<string, unknown>; body: string }

/** The front matter and the body of a document; an empty record when it has no front matter. */
export function documentOf(text: string): Document {
  return frontmatterOf(text) ?? { data: {}, body: text.replace(/\r\n/g, '\n') }
}

export const textOf = (value: unknown, max = 300): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined
}

export const numberOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : undefined
}

export const countOf = (value: unknown): number => {
  const number = numberOf(value)
  return number !== undefined && number > 0 ? Math.floor(number) : 0
}

export const listOf = (value: unknown, max = 2_000, length = 300): string[] => {
  const items = Array.isArray(value) ? value : typeof value === 'string' && value.trim() !== '' ? [value] : []
  return items.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim().slice(0, length)] : [])).slice(0, max)
}

/** The backticks around a whole value removed. */
export const uncode = (value: string): string => {
  const text = value.trim()
  return text.length >= 2 && text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text
}

export type Record_ = Record<string, string>

/** The rows of a table as records keyed by the lower-cased header; short rows are padded with ''. */
export function recordsOf(table: Table | undefined): Record_[] {
  if (table === undefined) return []
  const keys = table.header.map(cell => cell.toLowerCase())
  return table.rows.map(row => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ''])))
}

/** The records of the first table in `text`. */
export const firstRecords = (text: string): Record_[] => recordsOf(tablesIn(text)[0])

/** The bullet items of `text` with the backticks around each removed. */
export const itemsOf = (text: string): string[] => bulletsIn(text).map(uncode)

export type Card = {
  /** The `id` of a heading `id: title`. */
  id: string
  title: string
  /** The text before the first field. */
  prose: string
  /** Field bullets `- **key:** value`; a value with nested bullets is a list. */
  fields: Record<string, string | string[]>
  /** The subsections one level below the card, by title. */
  sections: Map<string, string>
}

const FIELD = /^- \*\*([^*:]+):\*\*[ ]?(.*)$/
const NESTED = /^\s{2,}[-*]\s+(.*)$/

/** The cards of `text`: every heading of exactly `level`, split into id, prose, fields and subsections. */
export function cardsOf(text: string, level: number): Card[] {
  const all = sectionsOf(text)

  return all
    .filter(section => section.level === level)
    .map(section => {
      const [id = '', ...rest] = section.title.split(': ')
      const head = linesOf(section.body.replace(/\r\n/g, '\n'))
      const end = head.findIndex(line => /^#{1,6}\s/.test(line))
      const intro = end < 0 ? head : head.slice(0, end)
      const fields: Record<string, string | string[]> = {}
      const prose: string[] = []
      let key: string | undefined

      for (const line of intro) {
        const field = FIELD.exec(line)
        const nested = NESTED.exec(line)

        if (field !== null) {
          key = (field[1] ?? '').trim()
          fields[key] = uncode(field[2] ?? '')
        } else if (nested !== null && key !== undefined) {
          const current = fields[key]
          fields[key] = [...(Array.isArray(current) ? current : current === undefined || current === '' ? [] : [current]), uncode(nested[1] ?? '')]
        } else if (line.trim() !== '') {
          key = undefined
          prose.push(line.trim())
        }
      }

      const sections = new Map(sectionsOf(section.body).filter(sub => sub.level === level + 1).map(sub => [sub.title, sub.body]))

      return { id: id.trim(), title: rest.join(': ').trim(), prose: prose.join(' '), fields, sections }
    })
}

/** A card field as a string. */
export const fieldText = (card: Card, key: string, max = 300): string | undefined => {
  const value = card.fields[key]
  return textOf(Array.isArray(value) ? value.join(', ') : value, max)
}

/** A card field as a list ('' is an empty list). */
export const fieldList = (card: Card, key: string, max = 2_000, length = 300): string[] => listOf(card.fields[key], max, length)

/** A subsection of a card by title, or ''. */
export const sectionText = (card: Card, title: string): string => card.sections.get(title) ?? ''
