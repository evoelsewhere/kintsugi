import { linesOf } from './text.js'

/**
 * The few Markdown shapes the stage documents are read by: sections under `#` headings,
 * GFM tables and bullet lists. The documents are written by agents, so nothing here is strict:
 * whatever does not fit is skipped, never thrown on.
 */

export type Section = {
  /** 1 for `#`, 2 for `##`, … */
  level: number
  title: string
  /** Index of the heading line in the document. */
  line: number
  /** The lines under the heading up to the next heading of the same or a higher level. */
  body: string
}

export type Table = {
  header: string[]
  rows: string[][]
}

/** Bold markers, `<br>` and runs of whitespace removed; backticks are kept for code spans. */
export const cellText = (cell: string): string =>
  cell
    .replace(/\*\*/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Every heading of `text` with the content it owns. Headings inside fenced code are not headings. */
export function sectionsOf(text: string): Section[] {
  const lines = linesOf(text.replace(/\r\n/g, '\n'))
  const headings: { index: number; level: number; title: string }[] = []
  let fenced = false

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced

      return
    }

    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)

    if (match !== null) {
      headings.push({ index, level: match[1]?.length ?? 1, title: cellText(match[2] ?? '') })
    }
  })

  return headings.map((heading, position) => {
    const end = headings.slice(position + 1).find(next => next.level <= heading.level)?.index ?? lines.length

    return { level: heading.level, title: heading.title, line: heading.index, body: lines.slice(heading.index + 1, end).join('\n') }
  })
}

/** The first section whose title matches `pattern`. */
export function sectionMatching(sections: readonly Section[], pattern: RegExp): Section | undefined {
  return sections.find(section => pattern.test(section.title))
}

const cellsOf = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let code = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]

    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
    } else if (char === '`') {
      code = !code
      current += char
    } else if (char === '|' && !code) {
      cells.push(cellText(current))
      current = ''
    } else {
      current += char
    }
  }

  cells.push(cellText(current))

  return cells
}

const isDelimiter = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

/** Every GFM table in `text`, in order: a header row, a delimiter row, then the body rows. */
export function tablesIn(text: string): Table[] {
  return tableRangesIn(text).map(range => range.table)
}

/** Source ranges let bounded table edits leave all surrounding Markdown untouched. */
export function tableRangesIn(text: string): Array<{ table: Table; line: number; end: number }> {
  const lines = linesOf(text)
  const tables: Array<{ table: Table; line: number; end: number }> = []
  let fenced = false

  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i] ?? ''
    if (/^\s*(```|~~~)/.test(head)) { fenced = !fenced; continue }
    if (fenced) continue

    if (!head.trim().startsWith('|') || !isDelimiter(lines[i + 1] ?? '')) {
      continue
    }

    const header = cellsOf(head)
    const rows: string[][] = []
    let j = i + 2

    while (j < lines.length && (lines[j] ?? '').trim().startsWith('|')) {
      rows.push(cellsOf(lines[j] ?? ''))
      j++
    }

    tables.push({ table: { header, rows }, line: i, end: j })
    i = j - 1
  }

  return tables
}

/** The column of `table` whose header matches `pattern`, or -1. */
export const columnOf = (table: Table, pattern: RegExp): number => table.header.findIndex(cell => pattern.test(cell))

/** The top-level bullet items of `text` (`- `, `* ` or `1. `), continuation lines joined. */
export function bulletsIn(text: string): string[] {
  const items: string[] = []
  let current: string | null = null

  for (const line of linesOf(text)) {
    const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line)

    if (item !== null) {
      if (current !== null) items.push(current)
      current = item[1] ?? ''
    } else if (current !== null && /^\s{2,}\S/.test(line)) {
      current += ` ${line.trim()}`
    } else if (current !== null) {
      items.push(current)
      current = null
    }
  }

  if (current !== null) items.push(current)

  return items.map(item => cellText(item)).filter(item => item !== '')
}

/** The paragraphs of `text` that are prose: not a table, list, heading, quote or fence. */
export function paragraphsIn(text: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let fenced = false
  const flush = () => {
    if (current.length > 0) paragraphs.push(cellText(current.join(' ')))
    current = []
  }

  for (const line of linesOf(text)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      flush()
      continue
    }

    const trimmed = line.trim()

    if (fenced || trimmed === '' || /^(\||#|>|[-*]\s|\d+\.\s)/.test(trimmed)) {
      flush()
      continue
    }

    current.push(trimmed)
  }

  flush()

  return paragraphs
}
