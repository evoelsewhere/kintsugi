import { describe, expect, test } from 'vitest'

import { parseDesignTemplate } from '../hooks/reader/design.js'
import { parseSecurityFindings } from '../hooks/reader/findings.js'
import { headingOf, sectionsOf } from '../hooks/reader/markdown.js'
import { parseRules } from '../hooks/reader/rules.js'
import { MAX_LINE } from '../hooks/reader/text.js'

// One line of a document must not hold the API (T3-011): the heading and card patterns backtracked on a long run of
// spaces, cubically for headings, quadratically for card titles.
const spaces = ' '.repeat(200_000)

const quickly = (read: () => unknown): void => {
  const started = performance.now()
  read()
  expect(performance.now() - started).toBeLessThan(500)
}

describe('headings', () => {
  const OLD = /^(#{1,6})\s+(.+?)\s*#*\s*$/
  const old = (line: string): { level: number; title: string } | null => {
    const match = OLD.exec(line)
    return match === null ? null : { level: match[1]!.length, title: match[2]! }
  }

  test('are read as the regex they replace read them', () => {
    const lines = ['# Title', '## Title ##', '### a b c   ', '# C# notes', '# x #y', '#nospace', '# ', '#  ', '#### Deep ###   ', '# a #', '# #', '# C#', '# a ## ##', '####### seven', '#\ttab', '# a\rb', '#\ra', '#  \r', '# a\u2028b']
    let seed = 7
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const alphabet = ['#', ' ', '\t', 'a', '\r', '\u2028', '\u00a0']
    for (let index = 0; index < 5000; index++) {
      const marker = '#'.repeat(Math.floor(next() * 8))
      lines.push(marker + Array.from({ length: Math.floor(next() * 9) }, () => alphabet[Math.floor(next() * alphabet.length)]).join(''))
    }
    for (const line of lines) expect(headingOf(line), JSON.stringify(line)).toEqual(old(line))
  })

  test('with a long run of spaces are read in linear time wherever a document is read', () => {
    // A reader cuts a line at MAX_LINE characters: the longest run it sees is just under it.
    quickly(() => expect(sectionsOf(`# a${' '.repeat(MAX_LINE - 10)}x\n\nbody\n`).map(section => section.title)).toEqual(['a x']))
    quickly(() => expect(sectionsOf(`# a${spaces}x\n\nbody\n`).map(section => section.title)).toEqual(['a']))
    quickly(() => parseDesignTemplate(`# a${spaces}x\n\n## b${spaces}y\n`))
    quickly(() => parseRules(`# a${spaces}x\n\n## b${spaces}y\n\n### RULE-001 · c${spaces}z\n\nbody\n`))
    quickly(() => parseSecurityFindings(`# Findings\n\n### SEC-001 · c${spaces}z\n\n**Severity:** High\n`))
  })

  test('of rule and finding cards keep their trimmed titles', () => {
    expect(parseRules('## Billing\n\n### RULE-001 · Tax is rounded   \n\nbody\n').rules.map(rule => [rule.id, rule.title])).toEqual([['RULE-001', 'Tax is rounded']])
    expect(parseSecurityFindings('# Findings\n\n### SEC-001 · Hard-coded key (High)  \n\n**Severity:** High\n').findings.map(finding => [finding.id, finding.title])).toEqual([['SEC-001', 'Hard-coded key']])
  })
})
