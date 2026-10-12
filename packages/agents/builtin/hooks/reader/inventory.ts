/**
 * `assessment/<app>/inventory.json`, written by the assess stage's inventory script: the figures
 * of record (files, lines, SLOC, complexity) per language and per file. Every field is treated
 * as optional; anything that does not fit is dropped, never thrown on.
 */

export type InventoryLanguage = {
  language: string
  files: number
  lines: number
  sloc: number
  complexity: number
}

export type InventoryFile = {
  path: string
  language: string
  lines: number
  sloc: number
  complexity: number
  bytes: number
}

export type Inventory = {
  app?: string
  sourceRepository?: string
  sourceCommit?: string
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
  files: InventoryFile[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const optNum = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** Parses inventory.json; null when the text is not an inventory. */
export function parseInventory(text: string): Inventory | null {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(raw)) {
    return null
  }

  const files: InventoryFile[] = []

  for (const entry of Array.isArray(raw.files) ? raw.files : []) {
    const path = isRecord(entry) ? str(entry.path) : undefined

    // `.git` is a worktree pointer, not part of the code.
    if (!isRecord(entry) || path === undefined || path === '.git' || path.startsWith('.git/')) {
      continue
    }

    files.push({
      path,
      language: str(entry.language) ?? 'Other',
      lines: num(entry.lines),
      sloc: num(entry.sloc ?? entry.codeLines),
      complexity: num(entry.cyclomaticComplexity ?? entry.complexity),
      bytes: num(entry.bytes),
    })
  }

  const languages: InventoryLanguage[] = []
  const metrics = isRecord(raw.languageMetrics) ? raw.languageMetrics : {}
  const counts = isRecord(raw.languages) ? raw.languages : {}

  for (const language of new Set([...Object.keys(metrics), ...Object.keys(counts)])) {
    const metric = metrics[language]
    const own = files.filter(file => file.language === language)

    languages.push(
      isRecord(metric)
        ? {
            language,
            files: num(metric.files),
            lines: num(metric.lines),
            sloc: num(metric.sloc ?? metric.codeLines),
            complexity: num(metric.complexity),
          }
        : {
            language,
            files: num(counts[language]) || own.length,
            lines: own.reduce((sum, file) => sum + file.lines, 0),
            sloc: own.reduce((sum, file) => sum + file.sloc, 0),
            complexity: own.reduce((sum, file) => sum + file.complexity, 0),
          },
    )
  }

  languages.sort((a, b) => b.sloc - a.sloc || b.files - a.files)

  const sloc = num(raw.sloc ?? raw.codeLines)

  if (files.length === 0 && languages.length === 0 && sloc === 0) {
    return null
  }

  const optional = {
    app: str(raw.app),
    sourceRepository: str(raw.sourceRepository),
    sourceCommit: str(raw.sourceCommit),
    method: str(raw.method),
    complexityIndexFormula: str(raw.complexityIndexFormula),
    complexityPerKsloc: optNum(raw.complexityPerKsloc),
  }

  return {
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    fileCount: num(raw.fileCount) || files.length,
    sourceFileCount: num(raw.sourceFileCount) || files.length,
    totalLines: num(raw.totalLines),
    sloc,
    ksloc: num(raw.ksloc) || Math.round(sloc) / 1000,
    totalBytes: num(raw.totalBytes),
    complexity: num(raw.complexity),
    complexityIndex: num(raw.complexityIndex),
    languages,
    files,
  }
}
