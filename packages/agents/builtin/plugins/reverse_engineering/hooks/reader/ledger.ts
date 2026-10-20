import { plain } from './text.js'
import type { ReviewLedger, ReviewVerdict } from './progress.js'

/**
 * The per-unit `rules-review.json` (`units/<module>/<unit>/`), read without trusting it. Each entry is `{ verdict, approver, date }`
 * keyed by rule id; `approver` becomes the verdict's title and `date` its `at`, so the panel keeps rendering. The retired
 * `RULE_REVIEWS.json` envelope of `{ reviews: { ... { verdict, at, title?, note? } } }` entries still parses, its `wrong` and
 * `discuss` verdicts renamed to `refuted` and `clarify`. The file sits in a workspace anyone may have edited, and a model may have
 * written it, so every value is checked: a verdict is one of three exact words, a rule id is one plain token, a title or a note is
 * cut to one short plain line, and anything else in an entry is dropped.
 */

const VERDICTS: readonly string[] = ['confirmed', 'refuted', 'clarify']

/** The verdict words a legacy envelope used, renamed to today's words. */
const LEGACY_VERDICTS: Record<string, ReviewVerdict> = { wrong: 'refuted', discuss: 'clarify' }

/** What a note may hold: a reviewer's sentence or two, not a document. */
export const MAX_NOTE = 500
const MAX_TITLE = 120
const MAX_ENTRIES = 5_000
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
const FORBIDDEN_ID = new Set(['__proto__', 'constructor', 'prototype'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const verdictOf = (value: unknown): ReviewVerdict | null => {
  if (typeof value !== 'string') {
    return null
  }

  return (VERDICTS.includes(value) ? value : LEGACY_VERDICTS[value]) as ReviewVerdict | undefined ?? null
}

/** The ledger one rules review holds; empty when it is not one. */
export function parseLedger(text: string | null): ReviewLedger {
  if (text === null || text.length > 4_000_000) {
    return {}
  }

  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }

  if (!isRecord(raw)) {
    return {}
  }

  // The retired `RULE_REVIEWS.json` wrapped its entries in `reviews`; a per-unit file is the entries themselves.
  const entries = isRecord(raw.reviews) ? raw.reviews : raw
  const ledger: ReviewLedger = {}

  for (const [id, item] of Object.entries(entries).slice(0, MAX_ENTRIES)) {
    if (!RULE_ID.test(id) || FORBIDDEN_ID.has(id) || !isRecord(item)) {
      continue
    }

    const verdict = verdictOf(item.verdict)

    if (verdict === null) {
      continue
    }

    const title = typeof item.title === 'string' ? plain(item.title, MAX_TITLE) : typeof item.approver === 'string' ? plain(item.approver, MAX_TITLE) : ''
    const note = typeof item.note === 'string' ? plain(item.note, MAX_NOTE) : ''
    // A time is kept only when it is one: the page shows its date. A per-unit file calls it `date`.
    const rawAt = typeof item.at === 'string' ? item.at : typeof item.date === 'string' ? item.date : ''
    const at = /^\d{4}-\d{2}-\d{2}/.test(rawAt) ? rawAt.slice(0, 40) : ''

    ledger[id] = { verdict, at, ...(title !== '' && { title }), ...(note !== '' && { note }) }
  }

  return ledger
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
