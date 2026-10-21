import { describe, expect, test } from 'vitest'

import { mergeLedgers, parseLedger, renderLedger } from '../hooks/reader/ledger.js'

describe('review ledger', () => {
  test('merges the verdicts of every unit into one, the newest per rule winning', () => {
    const merged = mergeLedgers([
      { 'RULE-1': { verdict: 'confirmed', at: '2026-10-15', title: 'dana' }, 'RULE-2': { verdict: 'refuted', at: '2026-10-16', title: 'lee' } },
      { 'RULE-1': { verdict: 'clarify', at: '2026-10-17', title: 'kim' } },
      parseLedger('| Rule | Verdict | Approver | Date | Note |\n| --- | --- | --- | --- | --- |\n| RULE-3 | refuted | old | 2026-10-01 | kept |\n| RULE-4 | clarify |  | 2026-10-02 |  |\n'),
    ])

    expect(merged).toEqual({
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
})
