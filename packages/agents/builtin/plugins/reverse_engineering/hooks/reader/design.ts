import { frontmatterOf } from './work-item.js'
import { cellText, tablesIn, type Table } from './markdown.js'
import { linesOf } from './text.js'

/**
 * Design sets (ADR-0044, ADR-0045): the project-defined templates of the design phase, read from `standards/design/<set>/`,
 * and the check of a unit's design document against its template.
 *
 * A set is a `set.md` (identity in the front matter, its documents in a table) and one template file per document. A
 * template is Markdown; under a heading, an HTML comment holds that section's contract, one directive per line:
 * `required`, `table: A | B`, `seed: rules`, `check: name(args)` (repeatable) and `guidance: text`.
 *
 * `modernize/scripts/design_lib.py` does the same for the member's harness. The two are held to the fixtures in
 * `modernize/scripts/tests/fixtures/design/`, so every message below is written exactly as the Python side writes it.
 */

export const DESIGN_CHECKS = ['no-placeholder', 'covers-rules', 'refs-resolve', 'id-pattern', 'max-length', 'one-of'] as const
export const DESIGN_SEEDS = ['rules'] as const
const REFERENCE_SOURCES = ['rules', 'requirements', 'components'] as const
/** The variables a scaffold substitutes in a template. */
export const DESIGN_TEMPLATE_VARIABLES = ['unit.id', 'unit.title', 'app.id', 'kind', 'set.id', 'set.version'] as const
const SET_ID = /^[a-z][a-z0-9-]{0,39}$/
const TEMPLATE_REF = /^([a-z][a-z0-9-]{0,39})@([1-9][0-9]{0,8})$/
const FILE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\.md$/
const PLACEHOLDER = /\b(?:TODO|TBD)\b/g
const SHOWN = 10

export type DesignCheck =
  | { name: 'no-placeholder' }
  | { name: 'covers-rules'; column: string }
  | { name: 'refs-resolve'; column: string; source: string }
  | { name: 'id-pattern'; column: string; pattern: string }
  | { name: 'max-length'; limit: number }
  | { name: 'one-of'; column: string; options: string[] }

export type DesignSection = {
  heading: string
  level: number
  required: boolean
  table?: string[]
  seed?: 'rules'
  checks: DesignCheck[]
  guidance?: string
}

export type DesignFile = { path: string; template: string; required: boolean; when: string[] }

export type DesignSet = {
  id: string
  title: string
  version: number
  appliesTo: string[]
  needs: string[]
  stage?: string
  files: DesignFile[]
  /** The text of `set.md` below its files table, for people. */
  description: string
}

export type DesignTemplate = { sections: DesignSection[] }

export type DesignProblemCode =
  | 'missing-template-ref'
  | 'wrong-template-ref'
  | 'missing-section'
  | 'empty-section'
  | 'missing-table'
  | 'table-columns'
  | 'placeholder'
  | 'uncovered-rules'
  | 'unresolved-reference'
  | 'id-pattern'
  | 'too-long'
  | 'not-allowed'

export type DesignProblem = { code: DesignProblemCode; section?: string; message: string }

/** What the ids a design points to are checked against. `items` maps the id of a set to the design items of the unit in it. */
export type DesignContext = {
  ruleIds: readonly string[]
  requirementIds: readonly string[]
  componentIds: readonly string[]
  items: Readonly<Record<string, readonly string[]>>
}

export type DesignSetSource = {
  /** The set's folder name under `standards/design/`. */
  folder: string
  /** The text of `set.md`; undefined when the folder has none. */
  setText: string | undefined
  /** The template files of the folder by file name. */
  templates: Readonly<Record<string, string>>
}

export type LoadedDesignSet = { set: DesignSet; templates: Record<string, DesignTemplate> }

export type DesignTemplateProblem = { path: string; message: string }

const list = (items: readonly string[]): string => {
  const shown = items.slice(0, SHOWN).join(', ')

  return items.length > SHOWN ? `${shown} and ${items.length - SHOWN} more` : shown
}

const unique = (items: readonly string[]): string[] => [...new Set(items)]

const stripComments = (text: string): string => text.replace(/<!--[\s\S]*?-->/g, '')

const norm = (value: string): string => cellText(value).toLowerCase()

// ---------------------------------------------------------------------------
// Reading a template: headings and the directive block under each

type Heading = { level: number; title: string; line: number }

function headingsOf(lines: readonly string[]): Heading[] {
  const found: Heading[] = []
  let fenced = false

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced

      return
    }

    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)

    if (match !== null) found.push({ level: match[1]?.length ?? 1, title: cellText(match[2] ?? ''), line: index })
  })

  return found
}

/** The directive comment right under a heading: its lines, or null when the heading carries none. */
function directiveBlock(lines: readonly string[], from: number, to: number): { lines: string[]; end: number } | null {
  let index = from

  while (index < to && (lines[index] ?? '').trim() === '') index++

  const first = (lines[index] ?? '').trim()

  if (index >= to || !first.startsWith('<!--')) return null

  const collected: string[] = []
  let current = first.slice(4)

  for (;;) {
    const close = current.indexOf('-->')

    if (close >= 0) {
      collected.push(current.slice(0, close))

      return { lines: collected.map(line => line.trim()).filter(line => line !== ''), end: index }
    }

    collected.push(current)
    index++

    if (index >= to) return { lines: collected.map(line => line.trim()).filter(line => line !== ''), end: to - 1 }

    current = lines[index] ?? ''
  }
}

function checkOf(value: string, problems: string[], heading: string): DesignCheck | null {
  const match = /^([a-z-]+)(?:\((.*)\))?$/.exec(value.trim())
  const name = match?.[1] ?? ''
  const args = (match?.[2] ?? '').trim()

  if (match === null || !(DESIGN_CHECKS as readonly string[]).includes(name)) {
    problems.push(`section "${heading}": unknown check "${value.trim()}"`)

    return null
  }

  const needs = (what: string): null => {
    problems.push(`section "${heading}": check "${name}" needs ${what}`)

    return null
  }

  if (name === 'no-placeholder') return { name }

  if (name === 'covers-rules') return args === '' ? needs('a column') : { name, column: args }

  if (name === 'refs-resolve') {
    const arrow = args.indexOf('->')
    const column = arrow < 0 ? '' : args.slice(0, arrow).trim()
    const source = arrow < 0 ? '' : args.slice(arrow + 2).trim()

    return column === '' || source === '' ? needs('a column and a source: refs-resolve(Column -> source)') : { name, column, source }
  }

  if (name === 'id-pattern') {
    const comma = args.indexOf(',')
    const column = comma < 0 ? '' : args.slice(0, comma).trim()
    const pattern = comma < 0 ? '' : args.slice(comma + 1).trim()

    return column === '' || pattern === '' ? needs('a column and a pattern: id-pattern(Column, pattern)') : { name, column, pattern }
  }

  if (name === 'max-length') return /^[1-9][0-9]{0,8}$/.test(args) ? { name, limit: Number(args) } : needs('a positive number')

  const comma = args.indexOf(',')
  const column = comma < 0 ? '' : args.slice(0, comma).trim()
  const options = comma < 0 ? [] : args.slice(comma + 1).split('|').map(option => option.trim()).filter(option => option !== '')

  return column === '' || options.length === 0 ? needs('a column and options: one-of(Column, a|b|c)') : { name: 'one-of', column, options }
}

/** The sections of a template: the headings that carry a directive block. `problems` are faults of the template itself. */
export function parseDesignTemplate(text: string): { template: DesignTemplate; problems: string[] } {
  const lines = linesOf(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  const headings = headingsOf(lines)
  const sections: DesignSection[] = []
  const problems: string[] = []

  for (const name of unique([...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(match => match[1] ?? ''))) {
    if (!(DESIGN_TEMPLATE_VARIABLES as readonly string[]).includes(name)) problems.push(`unknown variable "{{${name}}}"`)
  }

  headings.forEach((heading, position) => {
    const next = headings[position + 1]?.line ?? lines.length
    const block = directiveBlock(lines, heading.line + 1, next)

    if (block === null) return

    const section: DesignSection = { heading: heading.title, level: heading.level, required: false, checks: [] }
    const at = `section "${heading.title}"`

    if (sections.some(known => norm(known.heading) === norm(heading.title))) problems.push(`${at} is listed twice`)

    for (const line of block.lines) {
      if (line === 'required') {
        section.required = true
        continue
      }

      const pair = /^(table|seed|check|guidance):\s*(.*)$/.exec(line)

      if (pair === null) {
        problems.push(`${at}: unknown directive "${line}"`)
        continue
      }

      const value = (pair[2] ?? '').trim()

      if (pair[1] === 'table') {
        const columns = value.split('|').map(column => column.trim())

        if (columns.some(column => column === '')) problems.push(`${at}: table must name its columns separated by |`)
        else if (new Set(columns.map(column => column.toLowerCase())).size !== columns.length) problems.push(`${at}: table names a column twice`)
        else section.table = columns
      } else if (pair[1] === 'seed') {
        if ((DESIGN_SEEDS as readonly string[]).includes(value)) section.seed = value as 'rules'
        else problems.push(`${at}: unknown seed "${value}"`)
      } else if (pair[1] === 'check') {
        const check = checkOf(value, problems, heading.title)

        if (check !== null) section.checks.push(check)
      } else {
        section.guidance = value
      }
    }

    if (section.seed !== undefined && section.table === undefined) problems.push(`${at}: seed "${section.seed}" needs a table`)

    for (const check of section.checks) {
      if (check.name === 'no-placeholder' || check.name === 'max-length') continue

      if (section.table === undefined) {
        problems.push(`${at}: check "${check.name}" needs a table in the section`)
      } else if (!section.table.some(column => column.toLowerCase() === check.column.toLowerCase())) {
        problems.push(`${at}: check "${check.name}": column "${check.column}" is not in the section's table`)
      }

      if (check.name === 'id-pattern') {
        try {
          new RegExp(`^(?:${check.pattern})$`)
        } catch {
          problems.push(`${at}: id-pattern "${check.pattern}" is not a valid pattern`)
        }
      }
    }

    sections.push(section)
  })

  return { template: { sections }, problems }
}

// ---------------------------------------------------------------------------
// Reading set.md

const stringList = (value: unknown): string[] | null => {
  if (value === null || value === undefined || value === '') return []

  if (typeof value === 'string') return [value]

  return Array.isArray(value) && value.every(item => typeof item === 'string') ? (value as string[]).map(item => item.trim()).filter(item => item !== '') : null
}

/** One set, read from its `set.md`; `set` is absent when the file cannot give a usable identity. */
export function parseDesignSet(text: string, folder: string): { set?: DesignSet; problems: string[] } {
  const problems: string[] = []
  const front = frontmatterOf(text)

  if (front === null) return { problems: ['has no front matter'] }

  const id = typeof front.data.id === 'string' ? front.data.id.trim() : ''
  const title = typeof front.data.title === 'string' ? front.data.title.trim() : ''
  const version = front.data.version
  const appliesTo = stringList(front.data.appliesTo)
  const needs = stringList(front.data.needs)

  if (!SET_ID.test(id)) problems.push('id is missing or not a lowercase name (letters, digits, hyphens)')
  else if (id !== folder) problems.push(`id "${id}" does not match its folder "${folder}"`)

  if (title === '') problems.push('title is missing')

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) problems.push('version must be a positive integer')

  if (appliesTo === null) problems.push('appliesTo must be a list of unit kinds')

  if (needs === null) problems.push('needs must be a list of set ids')

  const stage = typeof front.data.stage === 'string' && front.data.stage.trim() !== '' ? front.data.stage.trim() : undefined
  const files: DesignFile[] = []
  const table = tablesIn(front.body).find(candidate => candidate.header.some(cell => norm(cell) === 'path') && candidate.header.some(cell => norm(cell) === 'template'))

  if (table === undefined) {
    problems.push('has no files table (columns Path | Template | Required | When)')
  } else {
    const column = (name: string): number => table.header.findIndex(cell => norm(cell) === name)
    const [pathAt, templateAt, requiredAt, whenAt] = [column('path'), column('template'), column('required'), column('when')]

    for (const row of table.rows) {
      const path = (row[pathAt] ?? '').replace(/`/g, '').trim()
      const template = (row[templateAt] ?? '').replace(/`/g, '').trim()
      const required = norm(row[requiredAt] ?? '')
      const at = `file "${path}"`

      if (!FILE_PATH.test(path) || path.split('/').includes('..')) {
        problems.push(`${at}: path must be a relative .md path with no ".."`)
        continue
      }

      if (files.some(known => known.path === path)) {
        problems.push(`${at} is listed twice`)
        continue
      }

      if (required !== 'yes' && required !== 'no') problems.push(`${at}: Required must be yes or no`)

      files.push({
        path,
        template,
        required: required === 'yes',
        when: whenAt < 0 ? [] : (row[whenAt] ?? '').split(/[,\s]+/).map(kind => kind.replace(/`/g, '').trim()).filter(kind => kind !== ''),
      })
    }

    if (table.rows.length === 0) problems.push('has no files table (columns Path | Template | Required | When)')
  }

  if (!SET_ID.test(id) || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || title === '' || appliesTo === null || needs === null) {
    return { problems }
  }

  const tableAt = front.body.indexOf('|')
  const after = tableAt < 0 ? front.body : front.body.split('\n').filter(line => !line.trim().startsWith('|') && !line.trim().startsWith('#')).join('\n')

  return { set: { id, title, version, appliesTo, needs, ...(stage === undefined ? {} : { stage }), files, description: after.trim() }, problems }
}

/** The files of a set that a unit of `kind` needs; none when the set is not for that kind. */
export function designFilesFor(set: DesignSet, kind: string): DesignFile[] {
  if (set.appliesTo.length > 0 && !set.appliesTo.includes(kind)) return []

  return set.files.filter(file => file.when.length === 0 || file.when.includes(kind))
}

const designPrefix = 'standards/design'

/**
 * Every set of the project and the faults of their definitions: unique ids that match their folders, existing
 * template files, known checks with valid parameters, `needs` without a cycle, kinds the project declares.
 * A set that cannot give a usable identity is left out; the others are returned, with their problems listed.
 */
export function loadDesignSets(sources: readonly DesignSetSource[], options: { unitKinds?: readonly string[] } = {}): { sets: LoadedDesignSet[]; problems: DesignTemplateProblem[] } {
  const problems: DesignTemplateProblem[] = []
  const sets: LoadedDesignSet[] = []
  const report = (path: string, message: string): void => void problems.push({ path, message })

  for (const source of [...sources].sort((a, b) => a.folder.localeCompare(b.folder))) {
    const setPath = `${designPrefix}/${source.folder}/set.md`

    if (source.setText === undefined) {
      report(setPath, 'is missing')
      continue
    }

    const read = parseDesignSet(source.setText, source.folder)

    for (const message of read.problems) report(setPath, message)

    if (read.set === undefined) continue

    const templates: Record<string, DesignTemplate> = {}

    for (const file of read.set.files) {
      const templatePath = `${designPrefix}/${source.folder}/${file.template}`
      const text = source.templates[file.template]

      if (text === undefined) {
        report(setPath, `file "${file.path}": template "${file.template}" does not exist in the set folder`)
        continue
      }

      if (file.template in templates) continue

      const parsed = parseDesignTemplate(text)

      templates[file.template] = parsed.template

      for (const message of parsed.problems) report(templatePath, message)

      for (const section of parsed.template.sections) {
        for (const check of section.checks) {
          if (check.name === 'refs-resolve' && !(REFERENCE_SOURCES as readonly string[]).includes(check.source) && !read.set.needs.includes(check.source)) {
            report(templatePath, `section "${section.heading}": refs-resolve source "${check.source}" is not rules, requirements, components or a set in needs`)
          }
        }
      }
    }

    for (const kind of read.set.appliesTo) {
      if (options.unitKinds !== undefined && !options.unitKinds.includes(kind)) report(setPath, `unit kind "${kind}" in appliesTo is not declared in unitKinds`)
    }

    for (const file of read.set.files) {
      for (const kind of file.when) {
        if (read.set.appliesTo.length > 0) {
          if (!read.set.appliesTo.includes(kind)) report(setPath, `file "${file.path}": kind "${kind}" in When is not one the set applies to`)
        } else if (options.unitKinds !== undefined && !options.unitKinds.includes(kind)) {
          report(setPath, `file "${file.path}": kind "${kind}" in When is not declared in unitKinds`)
        }
      }
    }

    sets.push({ set: read.set, templates })
  }

  const known = new Set(sets.map(loaded => loaded.set.id))
  const needsOf = new Map(sets.map(loaded => [loaded.set.id, loaded.set.needs] as const))

  for (const { set } of sets) {
    for (const need of set.needs) {
      if (!known.has(need)) report(`${designPrefix}/${set.id}/set.md`, `needs "${need}" is not a set of this project`)
    }
  }

  for (const { set } of sets) {
    const seen = new Set<string>()
    const walk = (id: string): boolean => {
      for (const need of needsOf.get(id) ?? []) {
        if (need === set.id) return true

        if (!seen.has(need)) {
          seen.add(need)

          if (walk(need)) return true
        }
      }

      return false
    }

    if (walk(set.id)) report(`${designPrefix}/${set.id}/set.md`, `needs makes a cycle that includes "${set.id}"`)
  }

  return { sets, problems }
}

// ---------------------------------------------------------------------------
// Checking a design document against its template

/** The text of a section: what is under its heading up to the next heading of the same or a higher level, without comments. */
function contentOf(lines: readonly string[], headings: readonly Heading[], position: number): string {
  const heading = headings[position] as Heading
  const end = headings.slice(position + 1).find(next => next.level <= heading.level)?.line ?? lines.length

  return stripComments(lines.slice(heading.line + 1, end).join('\n')).trim()
}

const tokensOf = (cell: string): string[] =>
  cell
    .replace(/`/g, '')
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(token => token !== '')

const columnCells = (table: Table, column: string): string[] => {
  const at = table.header.findIndex(cell => norm(cell) === column.toLowerCase())

  return at < 0 ? [] : table.rows.map(row => (row[at] ?? '').replace(/`/g, '').trim())
}

const hasColumn = (table: Table, column: string): boolean => table.header.some(cell => norm(cell) === column.toLowerCase())

const SKIPPED_TOKENS = new Set(['-', '—', '–', 'n/a', 'N/A', 'TODO', 'TBD'])

/** The ids a design offers as design items: the cells of every `ID` column of its tables. */
export function designItemIds(text: string): string[] {
  const ids: string[] = []

  for (const table of tablesIn(stripComments(text))) {
    for (const cell of columnCells(table, 'id')) {
      if (cell !== '' && !SKIPPED_TOKENS.has(cell)) ids.push(cell)
    }
  }

  return unique(ids)
}

/** The `template: <set>@<version>` reference of a design document, or null when it has none. */
export function designTemplateRefOf(text: string): string | null {
  const value = frontmatterOf(text)?.data.template

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Whether the design was written against an older version of its set. */
export function designIsStale(text: string, set: Pick<DesignSet, 'id' | 'version'>): boolean {
  const ref = designTemplateRefOf(text)
  const match = ref === null ? null : TEMPLATE_REF.exec(ref)

  return match !== null && match[1] === set.id && Number(match[2]) < set.version
}

/** The faults of one design document against its template and set; an empty list means it conforms. */
export function checkDesignDocument(template: DesignTemplate, set: Pick<DesignSet, 'id' | 'version'>, text: string, context: DesignContext): DesignProblem[] {
  const problems: DesignProblem[] = []
  const ref = designTemplateRefOf(text)

  if (ref === null) {
    problems.push({ code: 'missing-template-ref', message: 'front matter has no template reference (template: <set>@<version>)' })
  } else {
    const match = TEMPLATE_REF.exec(ref)

    if (match === null || match[1] !== set.id) problems.push({ code: 'wrong-template-ref', message: `template reference "${ref}" does not name this set (expected ${set.id}@${set.version})` })
  }

  const body = frontmatterOf(text)?.body ?? text
  const lines = linesOf(body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  const headings = headingsOf(lines)

  for (const section of template.sections) {
    const at = headings.findIndex(heading => norm(heading.title) === norm(section.heading))
    const fail = (code: DesignProblemCode, message: string): void => void problems.push({ code, section: section.heading, message })

    if (at < 0) {
      if (section.required) fail('missing-section', `missing section "${section.heading}"`)
      continue
    }

    const content = contentOf(lines, headings, at)
    const table = section.table === undefined ? undefined : tablesIn(content)[0]

    if (section.table !== undefined) {
      const expected = section.table.join(' | ')

      if (table === undefined) {
        if (section.required || content !== '') fail('missing-table', `no table; expected columns: ${expected}`)
      } else {
        const found = table.header.map(cell => norm(cell))

        if (found.length !== section.table.length || found.some((cell, index) => cell !== (section.table?.[index] ?? '').toLowerCase())) {
          fail('table-columns', `columns "${table.header.join(' | ')}" do not match "${expected}"`)
        } else if (section.required && table.rows.every(row => row.every(cell => cell.trim() === ''))) {
          fail('empty-section', 'section is empty')
        }
      }
    } else if (section.required && content === '') {
      fail('empty-section', 'section is empty')
    }

    // A check that needs a column is skipped while the table or the column is missing: that fault is already reported.
    const usable = (column: string): Table | undefined => (table !== undefined && hasColumn(table, column) ? table : undefined)

    for (const check of section.checks) {
      if (check.name === 'no-placeholder') {
        const found = unique(content.match(PLACEHOLDER) ?? [])

        if (found.length > 0) fail('placeholder', `unfinished text left: ${found.join(', ')}`)
      } else if (check.name === 'max-length') {
        if (content.length > check.limit) fail('too-long', `section has ${content.length} characters; the limit is ${check.limit}`)
      } else if (check.name === 'covers-rules') {
        const covered = new Set(columnCellsOf(usable(check.column), check.column).flatMap(tokensOf))
        const missing = context.ruleIds.filter(id => !covered.has(id))

        if (usable(check.column) !== undefined && missing.length > 0) fail('uncovered-rules', `rules without a design item: ${list(missing)}`)
      } else if (check.name === 'refs-resolve') {
        const known = new Set(
          check.source === 'rules' ? context.ruleIds : check.source === 'requirements' ? context.requirementIds : check.source === 'components' ? context.componentIds : (context.items[check.source] ?? []),
        )
        const loose = unique(columnCellsOf(usable(check.column), check.column).flatMap(tokensOf).filter(token => !SKIPPED_TOKENS.has(token) && !known.has(token)))

        if (loose.length > 0) fail('unresolved-reference', `references that do not resolve to ${check.source}: ${list(loose)}`)
      } else if (check.name === 'id-pattern') {
        const pattern = new RegExp(`^(?:${check.pattern})$`)
        const wrong = unique(columnCellsOf(usable(check.column), check.column).filter(cell => cell !== '' && !SKIPPED_TOKENS.has(cell) && !pattern.test(cell)))

        if (wrong.length > 0) fail('id-pattern', `values that do not match ${check.pattern}: ${list(wrong)}`)
      } else {
        const options = new Set(check.options.map(option => option.toLowerCase()))
        const wrong = unique(columnCellsOf(usable(check.column), check.column).filter(cell => cell !== '' && !SKIPPED_TOKENS.has(cell) && !options.has(cell.toLowerCase())))

        if (wrong.length > 0) fail('not-allowed', `values not among ${check.options.join('|')}: ${list(wrong)}`)
      }
    }
  }

  return problems
}

const columnCellsOf = (table: Table | undefined, column: string): string[] => (table === undefined ? [] : columnCells(table, column))

/**
 * The ids and titles of the rules a unit's `rules.md` documents: the rows of its rules table whose id starts with `RULE-`
 * (retired rules left out), else the older `### <id>: <title>` cards. Read the same way as `rules_of` in `design_lib.py`.
 */
export function ruleCardsOf(text: string): { id: string; title: string }[] {
  const source = (frontmatterOf(text)?.body ?? text).replace(/^\uFEFF/, '')
  const table = tablesIn(source)[0]

  if (table !== undefined) {
    const column = (name: string): number => table.header.findIndex(cell => norm(cell) === name)
    const [idAt, nameAt, statusAt] = [column('id'), column('name'), column('status')]
    const listed = table.rows
      .filter(row => (row[idAt] ?? '').startsWith('RULE-') && norm(row[statusAt] ?? '') !== 'retired')
      .map(row => ({ id: (row[idAt] ?? '').trim(), title: (row[nameAt] ?? '').trim() }))

    if (idAt >= 0 && listed.length > 0) return listed
  }

  const cards: { id: string; title: string }[] = []

  for (const heading of headingsOf(linesOf(source.replace(/\r\n/g, '\n')))) {
    if (heading.level !== 3) continue

    const colon = heading.title.indexOf(': ')
    const id = (colon < 0 ? heading.title : heading.title.slice(0, colon)).trim()

    if (id !== '') cards.push({ id, title: colon < 0 ? '' : heading.title.slice(colon + 2).trim() })
  }

  return cards
}

/** Which rules each `covers-rules` section of a design document names: `covered` lists every rule id found in its column. */
export function designCoverage(template: DesignTemplate, text: string, ruleIds: readonly string[]): { section: string; column: string; covered: string[] }[] {
  const body = frontmatterOf(text)?.body ?? text
  const lines = linesOf(body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  const headings = headingsOf(lines)
  const found: { section: string; column: string; covered: string[] }[] = []

  for (const section of template.sections) {
    const at = headings.findIndex(heading => norm(heading.title) === norm(section.heading))

    if (at < 0 || section.table === undefined) continue

    const table = tablesIn(contentOf(lines, headings, at))[0]

    for (const check of section.checks) {
      if (check.name !== 'covers-rules' || table === undefined || !hasColumn(table, check.column)) continue

      const named = new Set(columnCells(table, check.column).flatMap(tokensOf))

      found.push({ section: section.heading, column: check.column, covered: ruleIds.filter(id => named.has(id)) })
    }
  }

  return found
}

/** The ids each `refs-resolve` section of a design points to that do not resolve: the reading the check makes, without the cut of its message. */
export function designReferences(template: DesignTemplate, text: string, context: DesignContext): { section: string; column: string; source: string; unresolved: string[] }[] {
  const body = frontmatterOf(text)?.body ?? text
  const lines = linesOf(body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  const headings = headingsOf(lines)
  const found: { section: string; column: string; source: string; unresolved: string[] }[] = []

  for (const section of template.sections) {
    const at = headings.findIndex(heading => norm(heading.title) === norm(section.heading))

    if (at < 0 || section.table === undefined) continue

    const table = tablesIn(contentOf(lines, headings, at))[0]

    for (const check of section.checks) {
      if (check.name !== 'refs-resolve' || table === undefined || !hasColumn(table, check.column)) continue

      const known = new Set(
        check.source === 'rules' ? context.ruleIds : check.source === 'requirements' ? context.requirementIds : check.source === 'components' ? context.componentIds : (context.items[check.source] ?? []),
      )

      found.push({
        section: section.heading,
        column: check.column,
        source: check.source,
        unresolved: unique(columnCells(table, check.column).flatMap(tokensOf).filter(token => !SKIPPED_TOKENS.has(token) && !known.has(token))),
      })
    }
  }

  return found
}
