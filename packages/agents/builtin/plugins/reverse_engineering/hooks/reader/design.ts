import { frontmatterOf } from './work-item.js'
import { cellText, tablesIn, type Table } from './markdown.js'
import { linesOf } from './text.js'

/**
 * Design sets (ADR-0044, ADR-0045): the project-defined templates of the design phase, read from `01-standards/templates/<set>/`,
 * and the check of a unit's design document against its template.
 *
 * A set is a `set.md` (identity in the front matter, its documents in a table) and one template file per document. A
 * template is Markdown; under a heading, an HTML comment holds that section's contract, one directive per line:
 * `required`, `table: A | B`, `seed: rules`, `check: name(args)` (repeatable) and `guidance: text`.
 *
 * A set may hold a profile per unit kind (ADR-0053): a folder named after the kind, with a `profile.md` (its version, the
 * files it adds or removes, its instructions), templates that replace the set's own of the same name as whole files, and
 * `_examples/` for the designer. A document names the template it was written with: `set@n`, or `set/kind@n` for a profile's.
 *
 * `design/scripts/design_lib.py` does the same for the member's harness. The two are held to the fixtures in
 * `design/scripts/tests/fixtures/design/`, so every message below is written exactly as the Python side writes it.
 */

export const DESIGN_CHECKS = ['no-placeholder', 'covers-rules', 'refs-resolve', 'id-pattern', 'max-length', 'one-of'] as const
export const DESIGN_SEEDS = ['rules'] as const
const REFERENCE_SOURCES = ['rules', 'requirements', 'components'] as const
/** The variables a scaffold substitutes in a template. */
export const DESIGN_TEMPLATE_VARIABLES = ['unit.id', 'unit.title', 'app.id', 'kind', 'set.id', 'set.version'] as const
/** What a set is written for: each unit, or the application as a whole (ADR-0050). */
export const DESIGN_SCOPES = ['unit', 'application'] as const
/** Variables that only mean something for a unit. */
const UNIT_VARIABLES = ['unit.id', 'unit.title', 'kind'] as const
/** A document the designer also reads: relative, no `..`, `{app}` the only variable. */
const READ_PATH = /^[A-Za-z0-9{][A-Za-z0-9._/{}-]{0,159}$/
const SET_ID = /^[a-z][a-z0-9-]{0,39}$/
/** `set@n` or `set/kind@n`: the first group is the id of the template in use (`set` or `set/kind`). */
const TEMPLATE_REF = /^([a-z][a-z0-9-]{0,39}(?:\/[a-z][a-z0-9-]{0,39})?)@([1-9][0-9]{0,8})$/
const PROFILE_FILE = 'profile.md'
const EXAMPLES_DIR = '_examples'
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

export type DesignFile = { path: string; template: string; required: boolean }

export type DesignScope = (typeof DESIGN_SCOPES)[number]

export type DesignSet = {
  id: string
  title: string
  version: number
  /** `unit`: a design per unit (the default); `application`: one design for the whole application. */
  scope: DesignScope
  needs: string[]
  stage?: string
  /** Documents the designer reads besides the ones every design run sees (`{app}` allowed). */
  reads: string[]
  /** The files every unit kind has unless its profile changes them; none when the set is only for kinds with a profile. */
  files: DesignFile[]
  /** The text of `set.md` below its files table, for people (without the Instructions section). */
  description: string
  /** The `## Instructions` section of `set.md`: what the designer is told about this kind of design. */
  instructions: string
}

/** The variation of a set for one unit kind (ADR-0053), read from `<set>/<kind>/profile.md`. */
export type DesignProfile = {
  kind: string
  version: number
  /** Files added to the set's, or redefining the set's file of the same path. */
  files: DesignFile[]
  /** Paths of the set's files this kind does not have. */
  removes: string[]
  /** The `## Instructions` section of `profile.md`, read after the set's. */
  instructions: string
}

export type DesignTemplate = { sections: DesignSection[] }

/** What a document names in its `template:` reference: `id@version`, the id being `set` or `set/kind`. */
export type DesignTemplateRef = { id: string; version: number }

/** A file of a set for one kind: which template it is written with, the reference its documents carry, and its example. */
export type ResolvedDesignFile = DesignFile & {
  /** The kind whose folder holds the template; null for the set's own template. */
  profile: string | null
  ref: DesignTemplateRef
  /** The template, relative to the set folder (`logic.md`, or `screen/logic.md` for a profile's). */
  templateFile: string
  /** The finished example for the designer, relative to the set folder, or null. */
  example: string | null
}

export type DesignProblemCode =
  | 'missing-template-ref'
  | 'wrong-template-ref'
  | 'missing-section'
  | 'empty-section'
  | 'missing-table'
  | 'table-columns'
  | 'placeholder'
  | 'draft'
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

/** A kind folder of a set: its `profile.md` (undefined when it has none), its template files and the names in its `_examples/`. */
export type DesignProfileSource = {
  profileText: string | undefined
  templates: Readonly<Record<string, string>>
  examples?: readonly string[]
}

export type DesignSetSource = {
  /** The set's folder name under `01-standards/templates/`. */
  folder: string
  /** The text of `set.md`; undefined when the folder has none. */
  setText: string | undefined
  /** The template files of the folder by file name (not `set.md`). */
  templates: Readonly<Record<string, string>>
  /** The file names in the set's `_examples/` folder. */
  examples?: readonly string[]
  /** The kind folders of the set by folder name. */
  profiles?: Readonly<Record<string, DesignProfileSource>>
}

export type LoadedDesignProfile = { profile: DesignProfile; templates: Record<string, DesignTemplate>; examples: string[] }

/** `templates` are the set's own templates in use; a profile's `templates` are the ones in its folder that its files use. */
export type LoadedDesignSet = { set: DesignSet; templates: Record<string, DesignTemplate>; examples: string[]; profiles: Record<string, LoadedDesignProfile> }

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

/** The files table of `set.md` or `profile.md`; `retired` when it still has the `When` column that profiles replaced (ADR-0053). */
function readFilesTable(body: string, problems: string[]): { files: DesignFile[]; found: boolean; retired: boolean } {
  const files: DesignFile[] = []
  const table = tablesIn(body).find(candidate => candidate.header.some(cell => norm(cell) === 'path') && candidate.header.some(cell => norm(cell) === 'template'))

  if (table === undefined) return { files, found: false, retired: false }

  const column = (name: string): number => table.header.findIndex(cell => norm(cell) === name)
  const [pathAt, templateAt, requiredAt] = [column('path'), column('template'), column('required')]

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

    files.push({ path, template, required: required === 'yes' })
  }

  return { files, found: table.rows.length > 0, retired: column('when') >= 0 }
}

/** The `## Instructions` section of a set or profile body, for the designer, and the rest of the body. */
function splitInstructions(body: string): { instructions: string; rest: string[] } {
  const bodyLines = body.split('\n')
  const instructionsAt = bodyLines.findIndex(line => /^##\s+Instructions\s*$/i.test(line.trim()))

  if (instructionsAt < 0) return { instructions: '', rest: bodyLines }

  const end = bodyLines.findIndex((line, index) => index > instructionsAt && /^#{1,2}\s/.test(line.trim()))
  const stop = end < 0 ? bodyLines.length : end

  return { instructions: bodyLines.slice(instructionsAt + 1, stop).join('\n').trim(), rest: [...bodyLines.slice(0, instructionsAt), ...bodyLines.slice(stop)] }
}

/** One set, read from its `set.md`; `set` is absent when the file cannot give a usable identity. */
export function parseDesignSet(text: string, folder: string): { set?: DesignSet; problems: string[] } {
  const problems: string[] = []
  const front = frontmatterOf(text)

  if (front === null) return { problems: ['has no front matter'] }

  const id = typeof front.data.id === 'string' ? front.data.id.trim() : ''
  const title = typeof front.data.title === 'string' ? front.data.title.trim() : ''
  const version = front.data.version
  const needs = stringList(front.data.needs)

  if (!SET_ID.test(id)) problems.push('id is missing or not a lowercase name (letters, digits, hyphens)')
  else if (id !== folder) problems.push(`id "${id}" does not match its folder "${folder}"`)

  if (title === '') problems.push('title is missing')

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) problems.push('version must be a positive integer')

  if (front.data.appliesTo !== undefined && front.data.appliesTo !== null && front.data.appliesTo !== '' && !(Array.isArray(front.data.appliesTo) && front.data.appliesTo.length === 0)) {
    problems.push('appliesTo is replaced by a folder per unit kind with a profile.md (ADR-0053)')
  }

  if (needs === null) problems.push('needs must be a list of set ids')

  const scopeValue = front.data.scope === undefined || front.data.scope === null || front.data.scope === '' ? 'unit' : front.data.scope
  const scope: DesignScope = (DESIGN_SCOPES as readonly unknown[]).includes(scopeValue) ? (scopeValue as DesignScope) : 'unit'

  if (!(DESIGN_SCOPES as readonly unknown[]).includes(scopeValue)) problems.push('scope must be unit or application')

  const readsList = stringList(front.data.reads)

  if (readsList === null) problems.push('reads must be a list of document paths')

  const reads = readsList ?? []

  for (const entry of reads) {
    if (!READ_PATH.test(entry) || entry.split('/').includes('..') || entry.replace(/\{app\}/g, '').includes('{') || entry.replace(/\{app\}/g, '').includes('}')) {
      problems.push(`reads "${entry}" must be a relative path with no ".." (only {app} may be used as a variable)`)
    }
  }

  const stage = typeof front.data.stage === 'string' && front.data.stage.trim() !== '' ? front.data.stage.trim() : undefined
  const table = readFilesTable(front.body, problems)
  const files = table.files

  if (table.retired) problems.push('the When column is replaced by a folder per unit kind with a profile.md (ADR-0053)')

  // A unit set may have no files of its own when every kind has a profile: the loader decides. An application set has no profiles.
  if (scope === 'application' && !table.found) problems.push('has no files table (columns Path | Template | Required)')

  if (!SET_ID.test(id) || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || title === '' || needs === null) {
    return { problems }
  }

  // The Instructions section is for the designer, not for people reading the description.
  const { instructions, rest } = splitInstructions(front.body)
  const after = rest.filter(line => !line.trim().startsWith('|') && !line.trim().startsWith('#')).join('\n')

  return { set: { id, title, version, scope, needs, ...(stage === undefined ? {} : { stage }), reads, files, description: after.trim(), instructions }, problems }
}

/** One profile, read from `<set>/<kind>/profile.md`; `profile` is absent when the file cannot give a usable identity. */
export function parseDesignProfile(text: string, folder: string): { profile?: DesignProfile; problems: string[] } {
  const problems: string[] = []
  const front = frontmatterOf(text)

  if (front === null) return { problems: ['has no front matter'] }

  const kind = typeof front.data.kind === 'string' ? front.data.kind.trim() : ''
  const version = front.data.version
  const removes = stringList(front.data.removes)

  if (!SET_ID.test(kind)) problems.push('kind is missing or not a lowercase name (letters, digits, hyphens)')
  else if (kind !== folder) problems.push(`kind "${kind}" does not match its folder "${folder}"`)

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) problems.push('version must be a positive integer')

  if (removes === null) problems.push('removes must be a list of file paths')

  for (const entry of removes ?? []) {
    if (!FILE_PATH.test(entry) || entry.split('/').includes('..')) problems.push(`removes "${entry}" must be a relative .md path with no ".."`)
  }

  const table = readFilesTable(front.body, problems)

  if (table.retired) problems.push('the When column is not used in a profile: the profile is the kind')

  if (!SET_ID.test(kind) || kind !== folder || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || removes === null) return { problems }

  return { profile: { kind, version, files: table.files, removes, instructions: splitInstructions(front.body).instructions }, problems }
}

/** The files of a set for a unit kind, before their templates are located: the set's, with the profile's removed, redefined and added. */
function effectiveFiles(set: DesignSet, profile: DesignProfile | undefined): DesignFile[] {
  if (profile === undefined) return set.files

  const own = new Map(profile.files.map(file => [file.path, file] as const))
  const kept = set.files.filter(file => !profile.removes.includes(file.path)).map(file => own.get(file.path) ?? file)

  return [...kept, ...profile.files.filter(file => !set.files.some(known => known.path === file.path))]
}

/**
 * The files of a set that a unit of `kind` needs, each with the template it is written with; none when the set is not for that
 * kind. The set's files are the base ones, with the kind's profile applied (ADR-0053). A set of the application is not for any
 * unit: its files are asked for with a `null` kind.
 */
export function designFilesFor(loaded: LoadedDesignSet, kind: string | null): ResolvedDesignFile[] {
  if (loaded.set.scope === 'application' ? kind !== null : kind === null) return []

  return resolveFiles(loaded, kind === null ? undefined : loaded.profiles[kind])
}

/** The files of a set as a kind without a profile has them (the files of an application set): what `set.md` lists. */
export function designBaseFiles(loaded: LoadedDesignSet): ResolvedDesignFile[] {
  return resolveFiles(loaded, undefined)
}

function resolveFiles(loaded: LoadedDesignSet, profile: LoadedDesignProfile | undefined): ResolvedDesignFile[] {
  const { set } = loaded
  const kind = profile?.profile.kind

  return effectiveFiles(set, profile?.profile).map(file => {
    const inProfile = profile !== undefined && file.template in profile.templates
    const example = profile !== undefined && profile.examples.includes(file.template) ? `${kind}/${EXAMPLES_DIR}/${file.template}` : loaded.examples.includes(file.template) ? `${EXAMPLES_DIR}/${file.template}` : null

    return {
      ...file,
      profile: inProfile ? (kind ?? null) : null,
      ref: inProfile ? { id: `${set.id}/${kind}`, version: profile.profile.version } : { id: set.id, version: set.version },
      templateFile: inProfile ? `${kind}/${file.template}` : file.template,
      example,
    }
  })
}

/** The parsed template a resolved file is written with. */
export function designTemplateOf(loaded: LoadedDesignSet, file: ResolvedDesignFile): DesignTemplate | undefined {
  return file.profile === null ? loaded.templates[file.template] : loaded.profiles[file.profile]?.templates[file.template]
}

/** The text a document carries in its `template:` front matter for a reference. */
export const designRefText = (ref: DesignTemplateRef): string => `${ref.id}@${ref.version}`

/** Where a project's design sets live: `designSetsDir()` of the domain layout (a test keeps them equal; the reader imports nothing). */
export const DESIGN_SETS_PREFIX = '01-standards/templates'
const designPrefix = DESIGN_SETS_PREFIX

/**
 * Every set of the project and the faults of their definitions: unique ids that match their folders, existing
 * template files, known checks with valid parameters, `needs` without a cycle, kinds the project declares, and
 * profiles (ADR-0053) that name their kind, add and remove real files and leave no template unused.
 * A set that cannot give a usable identity is left out; the others are returned, with their problems listed.
 */
export function loadDesignSets(sources: readonly DesignSetSource[], options: { unitKinds?: readonly string[] } = {}): { sets: LoadedDesignSet[]; problems: DesignTemplateProblem[] } {
  const problems: DesignTemplateProblem[] = []
  const sets: LoadedDesignSet[] = []
  const report = (path: string, message: string): void => void problems.push({ path, message })

  for (const source of [...sources].sort((a, b) => a.folder.localeCompare(b.folder))) {
    const setDir = `${designPrefix}/${source.folder}`
    const setPath = `${setDir}/set.md`

    if (source.setText === undefined) {
      report(setPath, 'is missing')
      continue
    }

    const read = parseDesignSet(source.setText, source.folder)

    for (const message of read.problems) report(setPath, message)

    if (read.set === undefined) continue

    const { set } = read
    const templates: Record<string, DesignTemplate> = {}

    /** What a template says about itself that depends on the set: the unit-only features, and the sources its references may name. */
    const analyse = (text: string, parsed: { template: DesignTemplate }, templatePath: string): void => {
      if (set.scope === 'application') {
        for (const name of unique([...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(match => match[1] ?? ''))) {
          if ((UNIT_VARIABLES as readonly string[]).includes(name)) report(templatePath, `variable "{{${name}}}" is for unit sets`)
        }

        for (const section of parsed.template.sections) {
          if (section.seed === 'rules') report(templatePath, `section "${section.heading}": seed "rules" is for unit sets`)

          for (const check of section.checks) {
            if (check.name === 'covers-rules') report(templatePath, `section "${section.heading}": check "covers-rules" is for unit sets`)

            if (check.name === 'refs-resolve' && check.source === 'rules') report(templatePath, `section "${section.heading}": refs-resolve source "rules" is for unit sets`)
          }
        }
      }

      for (const section of parsed.template.sections) {
        for (const check of section.checks) {
          if (check.name === 'refs-resolve' && !(REFERENCE_SOURCES as readonly string[]).includes(check.source) && !set.needs.includes(check.source)) {
            report(templatePath, `section "${section.heading}": refs-resolve source "${check.source}" is not rules, requirements, components or a set in needs`)
          }
        }
      }
    }

    /** Reads a template of the set's own folder once; false when the folder has none of that name. */
    const useOwn = (name: string): boolean => {
      const text = source.templates[name]

      if (text === undefined) return false

      if (!(name in templates)) {
        const parsed = parseDesignTemplate(text)

        templates[name] = parsed.template

        for (const message of parsed.problems) report(`${setDir}/${name}`, message)

        analyse(text, parsed, `${setDir}/${name}`)
      }

      return true
    }

    for (const file of set.files) {
      if (!useOwn(file.template)) report(setPath, `file "${file.path}": template "${file.template}" does not exist in the set folder`)
    }

    const profiles: Record<string, LoadedDesignProfile> = {}

    for (const kind of Object.keys(source.profiles ?? {}).sort()) {
      const profileSource = (source.profiles ?? {})[kind] as DesignProfileSource
      const profileDir = `${setDir}/${kind}`
      const profilePath = `${profileDir}/${PROFILE_FILE}`

      if (set.scope === 'application') {
        report(profilePath, 'an application set cannot have profiles: an application has no unit kind')
        continue
      }

      if (!SET_ID.test(kind)) {
        report(profilePath, `"${kind}" is not a lowercase name (letters, digits, hyphens) for a unit kind`)
        continue
      }

      if (options.unitKinds !== undefined && !options.unitKinds.includes(kind)) report(profilePath, `unit kind "${kind}" is not declared in unitKinds`)

      if (profileSource.profileText === undefined) {
        report(profilePath, 'is missing')
        continue
      }

      const parsedProfile = parseDesignProfile(profileSource.profileText, kind)

      for (const message of parsedProfile.problems) report(profilePath, message)

      if (parsedProfile.profile === undefined) continue

      const { profile } = parsedProfile

      for (const path of profile.removes) {
        if (!set.files.some(file => file.path === path)) report(profilePath, `removes "${path}" is not a file of the set`)

        if (profile.files.some(file => file.path === path)) report(profilePath, `file "${path}" is both removed and defined`)
      }

      const own: Record<string, DesignTemplate> = {}
      const listed = new Set(profile.files.map(file => file.path))
      const effective = effectiveFiles(set, profile)

      for (const file of effective) {
        const text = profileSource.templates[file.template]

        if (text !== undefined) {
          if (!(file.template in own)) {
            const parsed = parseDesignTemplate(text)

            own[file.template] = parsed.template

            for (const message of parsed.problems) report(`${profileDir}/${file.template}`, message)

            analyse(text, parsed, `${profileDir}/${file.template}`)
          }
        } else if (listed.has(file.path) && !useOwn(file.template)) {
          report(profilePath, `file "${file.path}": template "${file.template}" exists neither in the profile folder nor in the set folder`)
        }
      }

      for (const name of Object.keys(profileSource.templates).sort()) {
        if (!effective.some(file => file.template === name)) report(`${profileDir}/${name}`, `is not used by any file of the kind "${kind}"`)
      }

      profiles[kind] = { profile, templates: own, examples: [...(profileSource.examples ?? [])].sort() }
    }

    if (set.scope === 'unit' && set.files.length === 0 && Object.keys(source.profiles ?? {}).length === 0) {
      report(setPath, 'has no files: list them in a table (Path | Template | Required) or add a folder per unit kind with a profile.md')
    }

    sets.push({ set, templates, examples: [...(source.examples ?? [])].sort(), profiles })
  }

  const known = new Set(sets.map(loaded => loaded.set.id))
  const needsOf = new Map(sets.map(loaded => [loaded.set.id, loaded.set.needs] as const))

  const scopeOf = new Map(sets.map(loaded => [loaded.set.id, loaded.set.scope] as const))

  for (const { set } of sets) {
    for (const need of set.needs) {
      if (!known.has(need)) report(`${designPrefix}/${set.id}/set.md`, `needs "${need}" is not a set of this project`)
      else if (set.scope === 'application' && scopeOf.get(need) === 'unit') report(`${designPrefix}/${set.id}/set.md`, `an application set cannot need "${need}", which is a unit set`)
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

/** The `template: <set>@<version>` (or `<set>/<kind>@<version>`) reference of a design document, or null when it has none. */
export function designTemplateRefOf(text: string): string | null {
  const value = frontmatterOf(text)?.data.template

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Whether the design was written against an older version of its template (`ref`: the template in use, ADR-0053). */
export function designIsStale(text: string, ref: DesignTemplateRef): boolean {
  const named = designTemplateRefOf(text)
  const match = named === null ? null : TEMPLATE_REF.exec(named)

  return match !== null && match[1] === ref.id && Number(match[2]) < ref.version
}

/** The faults of one design document against its template and set; an empty list means it conforms. */
export function checkDesignDocument(template: DesignTemplate, expected: DesignTemplateRef, text: string, context: DesignContext): DesignProblem[] {
  const problems: DesignProblem[] = []
  const ref = designTemplateRefOf(text)
  if (frontmatterOf(text)?.data['draft'] !== undefined && frontmatterOf(text)?.data['draft'] !== false) problems.push({ code: 'draft', message: 'Draft design: resolve its inputs and generate a final design before using it downstream.' })

  if (ref === null) {
    problems.push({ code: 'missing-template-ref', message: 'front matter has no template reference (template: <set>@<version>)' })
  } else {
    const match = TEMPLATE_REF.exec(ref)

    if (match === null || match[1] !== expected.id) problems.push({ code: 'wrong-template-ref', message: `template reference "${ref}" does not name this template (expected ${designRefText(expected)})` })
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
