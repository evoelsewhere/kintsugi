import { countOf, documentOf, listOf, numberOf, recordsOf, textOf } from './document.js'
import { sectionsOf, tablesIn } from './markdown.js'

/**
 * The file returned by `assessmentInventoryPath`, written by the assess stage's inventory script
 * (`scripts/inventory.py`): the figures of record in the front matter, then the languages, the directories,
 * the size distribution and the most complex files as tables. The per-file records stay in the run.
 * Every field is treated as optional; anything that does not fit is dropped, never thrown on.
 */

export type InventoryLanguage = {
  language: string
  files: number
  lines: number
  sloc: number
  complexity: number
}

/** One of the most complex files; the committed inventory lists these, not every file. */
export type InventoryFile = {
  path: string
  language: string
  lines: number
  sloc: number
  complexity: number
  bytes: number
}

export type InventoryDirectory = { path: string; files: number; sloc: number; complexity: number }

export type InventoryBucket = { label: string; files: number }

export type InventorySignals = {
  /** Source files with code: the denominator of the file statistics. */
  codeFiles: number
  medianSloc: number
  /** How many files hold half of all the complexity. */
  halfComplexityFiles: number
  /** Share of the complexity in the ten most complex files, 0..1. */
  topTenShare: number
  /** Files above 1,000 SLOC. */
  oversized: number
}

export type Inventory = {
  app?: string
  /** The legacy repositories measured and their commits, `<repository id>@<commit>`, in mount order (ADR-0052). */
  sources: string[]
  method?: string
  complexityIndexFormula?: string
  fileCount: number
  sourceFileCount: number
  totalLines: number
  sloc: number
  ksloc: number
  totalBytes: number
  complexity: number
  complexityIndex: number
  complexityPerKsloc?: number
  languages: InventoryLanguage[]
  /** The most complex files (the document lists the top fifty). */
  files: InventoryFile[]
  /** SLOC and complexity per directory, at `directoryDepth` levels. */
  directories: InventoryDirectory[]
  directoryDepth: number
  sizeDistribution: InventoryBucket[]
  signals: InventorySignals
}

const num = (value: unknown): number => numberOf(value) ?? 0

const tableUnder = (sections: ReturnType<typeof sectionsOf>, title: string) => tablesIn(sections.find(section => section.level === 2 && section.title === title)?.body ?? '')[0]

/** Parses inventory.md; null when the text is not an inventory. */
export function parseInventory(text: string): Inventory | null {
  const { data, body } = documentOf(text)
  const sections = sectionsOf(body)

  const languages = recordsOf(tableUnder(sections, 'Languages'))
    .map(row => ({ language: row.language ?? '', files: num(row.files), lines: num(row.lines), sloc: num(row.sloc), complexity: num(row.complexity) }))
    .filter(row => row.language !== '')
    .sort((a, b) => b.sloc - a.sloc || b.files - a.files)

  const files = recordsOf(tableUnder(sections, 'Most complex files'))
    .map(row => ({ path: row.path ?? '', language: row.language || 'Other', lines: num(row.lines), sloc: num(row.sloc), complexity: num(row.complexity), bytes: 0 }))
    // `.git` is a worktree pointer, not part of the code.
    .filter(row => row.path !== '' && row.path !== '.git' && !row.path.startsWith('.git/'))

  const directories = recordsOf(tableUnder(sections, 'Directories'))
    .map(row => ({ path: row.path ?? '', files: num(row.files), sloc: num(row.sloc), complexity: num(row.complexity) }))
    .filter(row => row.path !== '')

  const sizeDistribution = recordsOf(tableUnder(sections, 'Size distribution'))
    .map(row => ({ label: row['sloc per file'] ?? '', files: num(row.files) }))
    .filter(row => row.label !== '')

  const sloc = countOf(data.sloc)

  if (files.length === 0 && languages.length === 0 && sloc === 0) {
    return null
  }

  const optional = {
    app: textOf(data.app),
    method: textOf(data.method, 500),
    complexityIndexFormula: textOf(data.complexityIndexFormula),
    complexityPerKsloc: numberOf(data.complexityPerKsloc),
  }

  return {
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    sources: listOf(data.sources, 32, 200),
    fileCount: countOf(data.fileCount) || files.length,
    sourceFileCount: countOf(data.sourceFileCount) || files.length,
    totalLines: countOf(data.totalLines),
    sloc,
    ksloc: numberOf(data.ksloc) ?? Math.round(sloc) / 1000,
    totalBytes: countOf(data.totalBytes),
    complexity: countOf(data.complexity),
    complexityIndex: num(data.complexityIndex),
    languages,
    files,
    directories,
    directoryDepth: countOf(data.directoryDepth) || 1,
    sizeDistribution,
    signals: {
      codeFiles: countOf(data.codeFiles),
      medianSloc: num(data.medianSloc),
      halfComplexityFiles: countOf(data.halfComplexityFiles),
      topTenShare: num(data.topTenShare),
      oversized: countOf(data.oversized),
    },
  }
}
