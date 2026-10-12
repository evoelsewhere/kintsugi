import { citationsIn, type Citation } from './rules.js'
import { bulletsIn, cellText, columnOf, paragraphsIn, sectionMatching, sectionsOf, tablesIn, type Section, type Table } from './markdown.js'
import { linesOf } from './text.js'

/**
 * `assessment/<app>/SECURITY_FINDINGS.md` (the harden stage) and the Security Findings section of
 * `ASSESSMENT.md`, read into findings. The layout varies between runs: findings come from any
 * table with a severity column and an id or title column, or from `### SEC-001 · Title` cards
 * with labelled fields. Never throws.
 */

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const

export type Severity = (typeof SEVERITIES)[number]

export type FindingStatus = 'confirmed' | 'refuted' | 'unverified'

export type Confidence = 'High' | 'Medium' | 'Low'

export type Finding = {
  id: string
  title: string
  severity: Severity | 'Unknown'
  /** How sure the scan is (harden findings carry one; older documents do not). */
  confidence?: Confidence
  cwe?: string
  /** The location as written (`src/a.java:16-22`). */
  location?: string
  citations: Citation[]
  status: FindingStatus
  /** The card's text or the table row's remaining cells. */
  detail?: string
}

export type Scorecard = Record<Severity, number> & { total: number }

export type SecurityReport = {
  scorecard: Scorecard
  /** Whether the scorecard was read from the document (else it is counted from the findings). */
  scorecardStated: boolean
  topCwes?: string
  /** Findings refuted as false positives, when the document says how many. */
  refutedCount: number | null
  /** The `**Review coverage:**` line: how the code was reviewed and which files (no scanner runs in a job). */
  reviewCoverage?: string
  coverageGaps: string[]
  /** True when the document says every finder returned and every finding was judged. */
  coverageComplete: boolean
  findings: Finding[]
  cves: Table | null
  /** The assessment's security highlights, each confirmed as a finding, refuted or not judged. */
  carryOver: Table | null
  toolsNotRun: Table | null
  remediationLog: Table | null
  patchReview: string[]
  injectionFlags?: string
  credentials?: string
}

export const severityOf = (text: string): Severity | 'Unknown' => {
  const match = /\b(critical|high|medium|moderate|low|info(?:rmational)?)\b/i.exec(text)?.[1]?.toLowerCase()

  if (match === undefined) return 'Unknown'
  if (match === 'moderate') return 'Medium'
  if (match.startsWith('info')) return 'Info'

  return (match[0]?.toUpperCase() + match.slice(1)) as Severity
}

const cweOf = (text: string): string | undefined => {
  const ids = [...new Set([...text.matchAll(/CWE-\d+/gi)].map(match => match[0].toUpperCase()))]

  return ids.length === 0 ? undefined : ids.join(', ')
}

const confidenceOf = (text: string): Confidence | undefined => {
  const match = /\b(high|medium|low)\b/i.exec(text)?.[1]?.toLowerCase()

  return match === undefined ? undefined : ((match[0]?.toUpperCase() + match.slice(1)) as Confidence)
}

const FINDING_ID = /\b((?:SEC|RULE)-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*-\d+|[A-Z][A-Z0-9]*-\d+[a-z]?)\b/

/** Sections whose tables are not findings. */
const NOT_FINDINGS = /scorecard|cve|dependenc|tools?|remediation|patch review|credential|injection|carry-?over|carried/i

/** Findings in one GFM table, or none when the table has no severity column. */
export function findingsOfTable(table: Table, status: FindingStatus = 'confirmed'): Finding[] {
  const severity = columnOf(table, /severity|risk/i)
  const id = columnOf(table, /^(id|#|finding id)$/i)
  const title = columnOf(table, /title|finding|summary|issue|description|name/i)
  const cwe = columnOf(table, /cwe/i)
  const location = columnOf(table, /location|file|where|source/i)
  const verdict = columnOf(table, /status|verdict/i)
  const confidence = columnOf(table, /confidence/i)

  if (severity < 0 || (id < 0 && title < 0)) {
    return []
  }

  const findings: Finding[] = []

  table.rows.forEach((row, index) => {
    const cell = (column: number) => (column >= 0 ? (row[column] ?? '') : '')
    const titleText = cell(title)
    const idText = FINDING_ID.exec(cell(id))?.[1] ?? (id >= 0 && cell(id) !== '' ? cell(id) : `F-${index + 1}`)

    if (row.every(value => /^[-—–\s]*$/.test(value)) || (titleText === '' && id < 0)) {
      return
    }

    const verdictText = cell(verdict)
    const rowStatus: FindingStatus = /refuted|false positive/i.test(verdictText)
      ? 'refuted'
      : /not judged|unverified/i.test(verdictText)
        ? 'unverified'
        : status
    const used = new Set([severity, id, title, cwe, location, verdict, confidence])
    const rest = row.filter((_, column) => !used.has(column) && (row[column] ?? '') !== '').join(' · ')
    const where = cell(location)
    const cweText = cweOf(cell(cwe)) ?? (cwe >= 0 && cell(cwe) !== '' ? cell(cwe) : cweOf(titleText))
    const confidenceText = confidenceOf(cell(confidence))

    findings.push({
      id: idText,
      title: titleText === '' ? idText : titleText,
      severity: severityOf(cell(severity)),
      ...(confidenceText !== undefined && { confidence: confidenceText }),
      ...(cweText !== undefined && { cwe: cweText }),
      ...(where !== '' && { location: where }),
      citations: citationsIn(`${where} ${titleText}`),
      status: rowStatus,
      ...(rest !== '' && { detail: rest }),
    })
  })

  return findings
}

const CARD = /^#{3,4}\s+((?:SEC|RULE)-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*-\d+|[A-Z][A-Z0-9]*-\d+[a-z]?)\s*[·:\-–—]\s*(.+?)\s*$/

const labelled = (body: string, name: string): string | undefined => {
  const match = new RegExp(`^[ \\t>*-]*\\*\\*${name}:?\\*\\*:?[ \\t]*(.*)$`, 'im').exec(body)
  const text = match?.[1] !== undefined ? cellText(match[1]) : ''

  return text === '' ? undefined : text
}

/** Findings written as `### SEC-001 · Title` cards. */
function findingsOfCards(text: string, statusOf: (line: number) => FindingStatus): Finding[] {
  const lines = linesOf(text)
  const findings: Finding[] = []

  lines.forEach((line, index) => {
    const card = CARD.exec(line)

    if (card === null) {
      return
    }

    const end = lines.findIndex((next, at) => at > index && /^#{1,4}\s/.test(next))
    const body = lines.slice(index + 1, end < 0 ? lines.length : end).join('\n')
    const severityText = labelled(body, 'Severity') ?? card[2] ?? ''
    const location = labelled(body, '(?:Location|File)')
    const cwe = cweOf(labelled(body, 'CWE') ?? '') ?? cweOf(`${card[2] ?? ''} ${body}`)
    const confidence = confidenceOf(labelled(body, 'Confidence') ?? '')
    const detail = paragraphsIn(body.replace(/^[ \t>*-]*\*\*(?:Severity|Confidence|CWE|Location|File|Status):?\*\*.*$/gim, '')).join('\n\n')

    findings.push({
      id: card[1] ?? '',
      title: cellText(card[2] ?? '').replace(/\s*[([]?(Critical|High|Medium|Low)[)\]]?\s*$/i, ''),
      severity: severityOf(severityText),
      ...(confidence !== undefined && { confidence }),
      ...(cwe !== undefined && { cwe }),
      ...(location !== undefined && { location }),
      citations: citationsIn(location ?? body),
      status: statusOf(index),
      ...(detail !== '' && { detail }),
    })
  })

  return findings
}

const statusOfSection = (section: Section | undefined): FindingStatus =>
  section === undefined
    ? 'confirmed'
    : /refuted|false positive/i.test(section.title)
      ? 'refuted'
      : /coverage gaps|not judged|unverified/i.test(section.title)
        ? 'unverified'
        : 'confirmed'

const firstTable = (section: Section | undefined): Table | null => {
  const table = section === undefined ? undefined : tablesIn(section.body)[0]

  return table === undefined || table.rows.every(row => row.every(cell => /^[-—–\s]*$/.test(cell))) ? null : table
}

/** Parses SECURITY_FINDINGS.md. */
export function parseSecurityFindings(text: string): SecurityReport {
  const sections = sectionsOf(text)
  // The innermost section (level 2 or deeper) a line belongs to, for a finding's status.
  const sectionOfLine = (line: number): Section | undefined =>
    [...sections].reverse().find(section => section.line <= line && section.level >= 2)

  const findings: Finding[] = []
  const seen = new Set<string>()
  const add = (finding: Finding) => {
    const key = `${finding.id}|${finding.title}`

    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  }

  // Tables directly under a heading: only the leaf sections, so a table is read once.
  for (const section of sections) {
    if (section.level < 2 || NOT_FINDINGS.test(section.title)) {
      continue
    }

    const ownBody = section.body.split(/\n#{1,6}\s/)[0] ?? ''

    for (const table of tablesIn(ownBody)) {
      findingsOfTable(table, statusOfSection(section)).forEach(add)
    }
  }

  findingsOfCards(text, line => statusOfSection(sectionOfLine(line))).forEach(add)

  const scoreTable = firstTable(sectionMatching(sections, /scorecard|summary/i))
  const scorecard: Scorecard = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0, total: 0 }
  let stated = false

  if (scoreTable !== null && columnOf(scoreTable, /severity/i) >= 0) {
    const severity = columnOf(scoreTable, /severity/i)
    const count = columnOf(scoreTable, /count|findings|number/i)

    for (const row of scoreTable.rows) {
      const value = Number.parseInt((row[count < 0 ? 1 : count] ?? '').replace(/\D+/g, ''), 10)

      if (!Number.isFinite(value)) continue

      if (/total/i.test(row[severity] ?? '')) {
        scorecard.total = value
      } else {
        const level = severityOf(row[severity] ?? '')

        if (level !== 'Unknown') scorecard[level] = value
      }
    }

    stated = true
  }

  if (!stated) {
    for (const finding of findings) {
      if (finding.status === 'confirmed' && finding.severity !== 'Unknown') scorecard[finding.severity]++
    }
  }

  if (scorecard.total === 0) {
    scorecard.total = SEVERITIES.reduce((sum, level) => sum + scorecard[level], 0)
  }

  const refuted = /refuted(?: as false positives)?:?\**\s*:?\s*\**\s*(\d+)/i.exec(text)?.[1]
  const gaps = sectionMatching(sections, /coverage gaps/i)
  const gapText = gaps?.body ?? ''
  const coverageComplete = /all (?:\d+|five) finder classes returned/i.test(gapText)
  const coverageGaps = coverageComplete ? [] : bulletsIn(gapText)
  const injection = sectionMatching(sections, /injection/i)
  const credentials = sectionMatching(sections, /credential/i)
  const topCwes = /\*\*Top CWE categories:?\*\*:?\s*(.+)$/im.exec(text)?.[1]
  const reviewCoverage = /\*\*Review coverage:?\*\*:?\s*(.+)$/im.exec(text)?.[1]
  const review = sectionMatching(sections, /patch review/i)

  return {
    scorecard,
    scorecardStated: stated,
    ...(topCwes !== undefined && { topCwes: cellText(topCwes) }),
    ...(reviewCoverage !== undefined && { reviewCoverage: cellText(reviewCoverage) }),
    refutedCount: refuted === undefined ? findings.filter(finding => finding.status === 'refuted').length || null : Number(refuted),
    coverageGaps,
    coverageComplete,
    findings,
    cves: firstTable(sectionMatching(sections, /cve|dependenc/i)),
    carryOver: firstTable(sectionMatching(sections, /carry-?over|carried/i)),
    toolsNotRun: firstTable(sectionMatching(sections, /tools?/i)),
    remediationLog: firstTable(sectionMatching(sections, /remediation log/i)),
    patchReview: review === undefined ? [] : [...bulletsIn(review.body), ...tablesIn(review.body).flatMap(table => table.rows.map(row => row.join(' · ')))],
    ...(injection !== undefined && paragraphsIn(injection.body)[0] !== undefined && { injectionFlags: paragraphsIn(injection.body)[0] }),
    ...(credentials !== undefined && paragraphsIn(credentials.body)[0] !== undefined && { credentials: paragraphsIn(credentials.body)[0] }),
  }
}

/** Hunks of a unified diff (`@@` lines) and the finding ids its comment lines cite. */
export function patchSummary(text: string): { hunks: number; files: string[]; findings: string[] } {
  const files = new Set<string>()
  const findings = new Set<string>()
  let hunks = 0

  for (const line of linesOf(text)) {
    if (line.startsWith('@@')) hunks++
    const file = /^\+\+\+ b\/(.+)$/.exec(line)?.[1]

    if (file !== undefined) files.add(file.trim())

    const cited = /^#\s*([A-Z][A-Z0-9]*-\d+)\b/.exec(line)?.[1]

    if (cited !== undefined) findings.add(cited)
  }

  return { hunks, files: [...files], findings: [...findings] }
}
