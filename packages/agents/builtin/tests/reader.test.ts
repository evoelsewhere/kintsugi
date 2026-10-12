import { describe, expect, test } from 'vitest'

import { assessmentPath, goldenPath, runPath, SOURCE_REPOSITORY_ACCESS, sourcePath, targetPath } from '../hooks/reader/layout.js'
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

const topology = {
  system: 'sample-app',
  root: {
    id: 'root',
    name: 'Sample app',
    kind: 'system',
    children: [{ id: 'unit-one', name: 'Unit one', kind: 'module', file: 'Main.java' }],
  },
  edges: [],
  entryPoints: [],
  deadEnds: [],
  observations: ['Example observation'],
  flows: [],
}

describe('Kintsugi built-in progress reader', () => {
  test('lists only safe app directories under the assessment root', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile('assessment/sample-app/REPORT.md', 'Assessment')
    fs.addFile('assessment/other_app/REPORT.md', 'Assessment')
    fs.addFile('assessment/../outside/REPORT.md', 'Not a valid app')

    await expect(appsOf(fs)).resolves.toEqual(['other_app', 'sample-app'])
  })

  test('reads assessment artifacts and the separate source/target namespaces', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile('assessment/sample-app/topology.json', JSON.stringify(topology), 10)
    fs.addFile('assessment/sample-app/MODERNIZATION_BRIEF.md', '# Brief\n', 10)
    fs.addFile('source/sample-app/Main.java', 'class Main {}\n', 5)
    fs.addFile('target/sample-app/Main.java', 'class Main { int value; }\n', 20)

    const snapshot = await readSnapshot(fs, new Map(), {
      app: 'sample-app',
      actionPrefix: 'modernize-',
      nowMs: 100,
      track: 'transform',
    })

    expect(snapshot?.app).toBe('sample-app')
    expect(snapshot?.apps).toEqual(['sample-app'])
    expect(snapshot?.hasAssessment).toBe(true)
    expect(snapshot?.topology?.modules.map(module => module.id)).toContain('unit-one')
    expect(fs.reads).toContain('assessment/sample-app/topology.json')
    expect(fs.paths).toContain('target/sample-app')
  })

  test('falls back to the read-only source tree when no topology has been published', async () => {
    const fs = new MemoryReaderFs()
    fs.addFile('assessment/sample-app/MODERNIZATION_BRIEF.md', '# Brief\n', 10)
    fs.addFile('source/sample-app/Main.java', 'class Main {}\n', 5)

    await readSnapshot(fs, new Map(), {
      app: 'sample-app',
      actionPrefix: 'modernize-',
      nowMs: 100,
      track: 'transform',
    })

    expect(fs.paths).toContain('source/sample-app')
  })

  test('centralizes assessment, source, target, golden and run locations', () => {
    expect(assessmentPath('sample-app')).toBe('assessment/sample-app')
    expect(sourcePath('sample-app')).toBe('source/sample-app')
    expect(targetPath('sample-app')).toBe('target/sample-app')
    expect(targetPath('sample-app', 'uplift')).toBe('target/sample-app-uplift')
    expect(goldenPath('unit-one')).toBe('golden/unit-one')
    expect(runPath('unit-one', 'run-123')).toBe('runs/unit-one/run-123')
    expect(SOURCE_REPOSITORY_ACCESS).toBe('read-only')
  })

  test('rejects path traversal in app, unit and run identifiers', () => {
    expect(() => assessmentPath('../outside')).toThrow(/safe path segment/)
    expect(() => goldenPath('../outside')).toThrow(/safe path segment/)
    expect(() => runPath('unit-one', '..\\outside')).toThrow(/safe path segment/)
  })
})
