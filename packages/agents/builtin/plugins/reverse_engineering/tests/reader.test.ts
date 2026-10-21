import { describe, expect, test } from 'vitest'

import {
  assessmentPath,
  generatedPath,
  goldenPath,
  modulePath,
  rulesReviewPath,
  runPath,
  SOURCE_REPOSITORY_ACCESS,
  sourcePath,
  targetPath,
  toBePath,
  unitPath,
} from '../hooks/reader/layout.js'
import { mergeLedgers, parseLedger, renderLedger } from '../hooks/reader/ledger.js'
import { appsOf, readSnapshot } from '../hooks/reader/progress.js'
import type { ReaderFs } from '../hooks/reader/fs.js'

type FileValue = { text: string; mtimeMs: number }

class MemoryReaderFs implements ReaderFs {
  private readonly files = new Map<string, FileValue>()
  private readonly directories = new Set<string>([''])
  readonly reads: string[] = []
  readonly paths: string[] = []

  addFile(path: string, text: string, mtimeMs = 1): void {
    this.files.set(path, { text, mtimeMs })
    let parent = path.slice(0, path.lastIndexOf('/'))
    while (parent !== '') {
      this.directories.add(parent)
      parent = parent.slice(0, parent.lastIndexOf('/'))
    }
  }

  async exists(path: string): Promise<boolean> {
    this.paths.push(path)
    return this.files.has(path) || this.directories.has(path)
  }

  async read(path: string): Promise<string> {
    this.paths.push(path)
    this.reads.push(path)
    const value = this.files.get(path)
    if (value === undefined) throw new Error(`missing file: ${path}`)
    return value.text
  }

  async stat(path: string): Promise<{ kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }> {
    this.paths.push(path)
    const file = this.files.get(path)
    if (file !== undefined) return { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs }
    if (this.directories.has(path)) return { kind: 'dir', size: 0, mtimeMs: 1 }
    throw new Error(`missing path: ${path}`)
  }

  async list(path: string): Promise<{ name: string; kind: 'file' | 'dir' | 'other'; size: number; isLink?: boolean }[]> {
    this.paths.push(path)
    const prefix = path === '' ? '' : `${path}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const key of [...this.files.keys(), ...this.directories]) {
      if (!key.startsWith(prefix) || key === path) continue
      const tail = key.slice(prefix.length)
      const name = tail.split('/')[0]
      if (name === undefined || name === '') continue
      names.set(name, tail.includes('/') || this.directories.has(key) ? 'dir' : 'file')
    }
    return [...names.entries()].map(([name, kind]) => ({ name, kind, size: 0 }))
  }
}

const topology = `---
system: "sample-app"
---
# Topology of sample-app

## Domains

| Domain | Leaves | Data stores | LOC |
| --- | --- | --- | --- |
| Core | 1 | 0 | 5 |

## Leaves

| Leaf | Name | Kind | Domain | File | LOC | Entry point | Dead end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| unit-one | Unit one | module | Core | Main.java | 5 |  |  |
`

const readOptions = {
  app: 'sample-app',
  actionPrefix: 'modernize-',
  nowMs: 100,
  track: 'transform',
} as const

describe('Kintsugi built-in progress reader', () => {
  test('lists only safe app directories under the applications root', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile('applications/sample-app/assessment/REPORT.md', 'Assessment')
    fs.addFile('applications/other_app/assessment/REPORT.md', 'Assessment')
    fs.addFile('applications/../outside/REPORT.md', 'Not a valid app')
    await expect(appsOf(fs)).resolves.toEqual(['other_app', 'sample-app'])
  })

  test('reads each stage file from its ADR-0042 home', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile('applications/sample-app/assessment/topology.md', topology, 42)
    fs.addFile(
      'applications/sample-app/to-be/modernization-brief.md',
      '# Sample app → Java/Spring\n\nApproved by: Dana\nDate: 2026-10-15\n',
      10,
    )
    const snapshot = await readSnapshot(fs, new Map(), readOptions)
    expect(fs.reads).toContain('applications/sample-app/assessment/topology.md')
    expect(fs.reads).toContain('applications/sample-app/to-be/modernization-brief.md')
    expect(snapshot?.topology?.modules.map(module => module.id)).toContain('unit-one')
    expect(snapshot?.brief?.approval.isSigned).toBe(true)
    expect(snapshot?.hasAssessment).toBe(true)
    expect(snapshot?.apps).toContain('sample-app')
    expect(fs.paths).toContain('target/sample-app')
  })

  test('keeps the brief readable when the assessment is missing', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile(
      'applications/sample-app/to-be/modernization-brief.md',
      '# Sample app → Java/Spring\n\nApproved by: Dana\nDate: 2026-10-15\n',
    )
    const snapshot = await readSnapshot(fs, new Map(), readOptions)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.brief?.approval.isSigned).toBe(true)
    expect(snapshot?.hasAssessment).toBe(false)
    expect(fs.paths).toContain('source/sample-app')
  })

  test('merges every unit rule review into one ledger', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile(
      'applications/sample-app/units/tax/calc/understanding/rules-review.md',
      '| Rule | Verdict | Approver | Date |\n| --- | --- | --- | --- |\n| RULE-1 | confirmed | dana | 2026-10-15 |\n| RULE-2 | refuted | lee | 2026-10-16 |\n',
      5,
    )
    fs.addFile(
      'applications/sample-app/units/tax/round/understanding/rules-review.md',
      '| Rule | Verdict | Approver | Date |\n| --- | --- | --- | --- |\n| RULE-1 | clarify | kim | 2026-10-17 |\n',
      6,
    )
    fs.addFile(
      'applications/sample-app/units/legacy/one/understanding/rules-review.md',
      '| Rule | Verdict | Approver | Date | Note |\n| --- | --- | --- | --- | --- |\n| RULE-3 | refuted | old | 2026-10-01 | kept |\n| RULE-4 | clarify |  | 2026-10-02 |  |\n',
      7,
    )
    const snapshot = await readSnapshot(fs, new Map(), readOptions)
    expect(snapshot?.reviews).toEqual({
      'RULE-1': { verdict: 'clarify', at: '2026-10-17', title: 'kim' },
      'RULE-2': { verdict: 'refuted', at: '2026-10-16', title: 'lee' },
      'RULE-3': { verdict: 'refuted', at: '2026-10-01', title: 'old', note: 'kept' },
      'RULE-4': { verdict: 'clarify', at: '2026-10-02' },
    })
  })

  test('drops verdicts it cannot read without trusting the file', () => {
    const table = (...rows: string[]): string => ['| Rule | Verdict | Approver | Date |', '| --- | --- | --- | --- |', ...rows].join('\n')

    expect(parseLedger(null)).toEqual({})
    expect(parseLedger('not a table')).toEqual({})
    expect(parseLedger(table('| RULE-1 | maybe | dana | 2026-10-15 |'))).toEqual({})
    expect(parseLedger(table('| __proto__ | confirmed | dana | 2026-10-15 |'))).toEqual({})
    expect(parseLedger(table('| RULE-1 | confirmed | dana | yesterday |'))).toEqual({
      'RULE-1': { verdict: 'confirmed', at: '', title: 'dana' },
    })
    expect(mergeLedgers([{ 'RULE-1': { verdict: 'confirmed', at: '2026-10-15' } }, {}])).toEqual({
      'RULE-1': { verdict: 'confirmed', at: '2026-10-15' },
    })
  })

  test('renders a ledger as the table it is read from', () => {
    const ledger = { 'RULE-2': { verdict: 'refuted' as const, at: '2026-10-16', title: 'lee', note: 'a | b' }, 'RULE-1': { verdict: 'confirmed' as const, at: '2026-10-15' } }

    expect(parseLedger(renderLedger(ledger))).toEqual({
      'RULE-1': { verdict: 'confirmed', at: '2026-10-15' },
      'RULE-2': { verdict: 'refuted', at: '2026-10-16', title: 'lee', note: 'a | b' },
    })
  })

  test('centralizes the document-repository and workspace locations', () => {
    expect(assessmentPath('sample-app')).toBe('applications/sample-app/assessment')
    expect(generatedPath('sample-app')).toBe('applications/sample-app/generated')
    expect(toBePath('sample-app')).toBe('applications/sample-app/to-be')
    expect(modulePath('sample-app', 'tax')).toBe('applications/sample-app/units/tax')
    expect(unitPath('sample-app', 'tax', 'calc')).toBe('applications/sample-app/units/tax/calc')
    expect(rulesReviewPath('sample-app', 'tax', 'calc')).toBe('applications/sample-app/units/tax/calc/understanding/rules-review.md')
    expect(goldenPath('sample-app', 'tax', 'calc')).toBe('applications/sample-app/units/tax/calc/verify/golden')
    expect(runPath('sample-app', 'tax', 'calc', 'run-123')).toBe('applications/sample-app/units/tax/calc/verify/runs/run-123')
    expect(sourcePath('sample-app')).toBe('source/sample-app')
    expect(targetPath('sample-app')).toBe('target/sample-app')
    expect(targetPath('sample-app', 'uplift')).toBe('target/sample-app-uplift')
    expect(SOURCE_REPOSITORY_ACCESS).toBe('read-only')
  })

  test('rejects path traversal in app, module, unit and run identifiers', () => {
    expect(() => assessmentPath('../outside')).toThrow(/safe path segment/)
    expect(() => modulePath('sample-app', '../outside')).toThrow(/safe path segment/)
    expect(() => goldenPath('sample-app', 'tax', '..\\outside')).toThrow(/safe path segment/)
    expect(() => runPath('sample-app', 'tax', 'calc', '..\\outside')).toThrow(/safe path segment/)
  })
})
