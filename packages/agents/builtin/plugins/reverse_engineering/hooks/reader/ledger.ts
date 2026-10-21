import { plain } from './text.js'
import { recordsOf } from './document.js'
import { tablesIn } from './markdown.js'
import type { ReviewLedger, ReviewVerdict } from './progress.js'

/**
 * The per-unit `rules-review.md` (`units/<module>/<unit>/understanding/`), read without trusting it: a table
 * `Rule | Verdict | Approver | Date` (and an optional `Note`) keyed by rule id; `approver` becomes the verdict's title
 * and `date` its `at`, so the panel keeps rendering. The file sits in a workspace anyone may have edited, and a model
 * may have written it, so every value is checked: a verdict is one of three exact words, a rule id is one plain token, a
 * title or a note is cut to one short plain line, and anything else in a row is dropped.
 */

const VERDICTS: readonly string[] = ['confirmed', 'refuted', 'clarify']

/** What a note may hold: a reviewer's sentence or two, not a document. */
export const MAX_NOTE = 500
const MAX_TITLE = 120
const MAX_ENTRIES = 5_000
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
const FORBIDDEN_ID = new Set(['__proto__', 'constructor', 'prototype'])

const verdictOf = (value: string): ReviewVerdict | null => (VERDICTS.includes(value.toLowerCase()) ? (value.toLowerCase() as ReviewVerdict) : null)

/** The ledger one rules review holds; empty when it is not one. */
export function parseLedger(text: string | null): ReviewLedger {
  if (text === null || text.length > 4_000_000) {
    return {}
  }

  const ledger: ReviewLedger = {}

  for (const row of recordsOf(tablesIn(text.replace(/\r\n/g, '\n'))[0]).slice(0, MAX_ENTRIES)) {
    const id = (row.rule ?? '').replace(/`/g, '').trim()
    const verdict = verdictOf((row.verdict ?? '').trim())

    if (!RULE_ID.test(id) || FORBIDDEN_ID.has(id) || verdict === null) {
      continue
    }

    const title = plain(row.approver ?? '', MAX_TITLE)
    const note = plain(row.note ?? '', MAX_NOTE)
    // A time is kept only when it is one: the page shows its date.
    const rawAt = row.date ?? ''
    const at = /^\d{4}-\d{2}-\d{2}/.test(rawAt) ? rawAt.slice(0, 40) : ''

    ledger[id] = { verdict, at, ...(title !== '' && { title }), ...(note !== '' && { note }) }
  }

  return ledger
}

/** The ledger as the `rules-review.md` table: `Rule | Verdict | Approver | Date | Note`, rules in id order. */
export function renderLedger(ledger: ReviewLedger): string {
  const cell = (value: string | undefined): string => (value ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim()
  const rows = Object.entries(ledger)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => `| ${id} | ${entry.verdict} | ${cell(entry.title)} | ${entry.at.slice(0, 10)} | ${cell(entry.note)} |`)

  return ['# Rule verdicts', '', '| Rule | Verdict | Approver | Date | Note |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n')
}

/**
 * Every unit's ledger merged into the one ledger the panel counts. A rule several units reviewed keeps
 * the newest verdict; the ledgers are read in sorted unit order, and a tie keeps the first read.
 */
export function mergeLedgers(ledgers: Iterable<ReviewLedger>): ReviewLedger {
  const merged: ReviewLedger = {}

  for (const ledger of ledgers) {
    for (const [id, entry] of Object.entries(ledger)) {
      const onDisk = merged[id]

      if (onDisk === undefined || (entry.at !== '' && entry.at > onDisk.at)) {
        merged[id] = entry
      }
    }
  }

  return merged
}

/**
 * The file's ledger with the current job or reader snapshot's decisions on top. `edits` maps a rule id to what the deck set it to, or null when the
 * deck took its verdict back. What the other writer put in the file meanwhile stays, and a note the deck did not write is
 * kept on a rule the deck decided again.
 */
export function mergeLedger(onDisk: ReviewLedger, edits: ReadonlyMap<string, ReviewLedger[string] | null>): ReviewLedger {
  const merged: ReviewLedger = { ...onDisk }

  for (const [id, edit] of edits) {
    if (edit === null) {
      delete merged[id]
    } else {
      const note = edit.note ?? onDisk[id]?.note

      merged[id] = { ...edit, ...(note !== undefined && { note }) }
    }
  }

  return merged
}
