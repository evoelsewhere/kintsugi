"""The gaps of a specification (ADR-0057): the `## Gaps and questions` table every AS-IS specification ends with.

One parser for `finish_items.py` (the count and the report of a table that does not read) and
`rebuild_aggregates.py` (the application's `_generated/GAPS.md`). The reader `hooks/reader/gaps.ts` parses the same
table in the portal and the API; both are held to the shared fixtures in `scripts/tests/fixtures/gaps/`.
Standard library only.
"""
import re

import docmd
import reference_ids as refs

GAP_ID = re.compile(r'^GAP-[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,}$')
GAP_KINDS = ('missing-source', 'unresolved', 'ambiguous', 'unverified')
GAP_IMPACTS = ('blocking', 'risk', 'note')
GAPS_SECTION = 'gaps and questions'
GAP_REFERENCE = re.compile(r'(?<![A-Za-z0-9._-])GAP-[A-Za-z0-9][A-Za-z0-9._-]*-[0-9]{2,}(?![A-Za-z0-9_-])')


def spec_gaps(text):
    """(rows, problems) of the `## Gaps and questions` table of a specification: the rows whose ID is a gap id, as dicts
    keyed by the lower-cased column names (id, kind, question, where, impact). `rows` is None when the section is missing."""
    body = next((body for title, body in docmd.sections(text, 2) if title.strip().lower() == GAPS_SECTION), None)
    if body is None:
        return None, [f'no "{GAPS_SECTION.capitalize()}" section']
    rows, problems, seen = [], [], set()
    for row in docmd.records_in(body):
        ident = docmd.uncode(row.get('id', '')).strip()
        if not ident:
            continue
        if not GAP_ID.match(ident):
            problems.append(f'{ident[:40]} is not a gap id (GAP-<scope>-0001)')
            continue
        if ident in seen:
            problems.append(f'{ident} is listed twice')
            continue
        seen.add(ident)
        kind, impact = row.get('kind', '').strip(), row.get('impact', '').strip()
        if kind not in GAP_KINDS:
            problems.append(f'{ident} has kind "{kind[:30]}", not one of {", ".join(GAP_KINDS)}')
        if impact not in GAP_IMPACTS:
            problems.append(f'{ident} has impact "{impact[:30]}", not one of {", ".join(GAP_IMPACTS)}')
        rows.append({**row, 'id': ident, 'kind': kind, 'impact': impact})
    return rows, problems


def checked_gaps(text):
    """Strict writer validation, shared by the specification output hook and finish."""
    rows, problems = spec_gaps(text)
    if problems:
        raise refs.DataError('invalid specification gaps: ' + '; '.join(problems[:5]))
    sections = [body for title, body in docmd.sections(text, 2) if title.strip().lower() == GAPS_SECTION]
    if len(sections) != 1:
        raise refs.DataError('specification needs exactly one Gaps and questions section')
    body = sections[0]
    tables = docmd.tables_in(body)
    if tables:
        if len(tables) != 1 or not {'id', 'kind', 'question', 'where', 'impact'}.issubset({column.lower() for column in tables[0][0]}):
            raise refs.DataError('gaps table needs ID, Kind, Question, Where and Impact columns')
        if any(not row.get('id', '').strip() for row in docmd.records_in(body)):
            raise refs.DataError('every gap row needs an ID')
    elif body.strip().lower() != 'none.':
        raise refs.DataError('gaps section needs a table or an explicit None.')
    for row in rows or []:
        if not row.get('question', '').strip() or not row.get('where', '').strip():
            raise refs.DataError(f'{row["id"]}: a gap needs a question and evidence location')
    known = {row['id'] for row in rows or []}
    dangling = set(GAP_REFERENCE.findall(text)) - known
    if dangling:
        raise refs.DataError('gap reference has no table row: ' + ', '.join(sorted(dangling)))
    facts = {}
    for row in rows or []:
        key = gap_identity(row)
        if key in facts and facts[key] != row['impact']:
            raise refs.DataError(f'{row["id"]}: equivalent gaps have conflicting impacts')
        facts[key] = row['impact']
    return rows or []


def gap_identity(row):
    return refs.fingerprint(row.get('kind'), docmd.uncode(row.get('where', '')), refs.normalized(row.get('question')))


def _deduplicate_rows(text, replacements):
    """Keep the first row per published ID, preserving prose, other sections and formatting."""
    lines, seen, in_gaps, fenced, id_column = [], set(), False, False, None
    for line in text.splitlines(keepends=True):
        if re.match(r'^\s*(```|~~~)', line):
            fenced = not fenced
        if not fenced:
            heading = re.match(r'^(#{1,2})\s+(.+?)\s*#*\s*$', line)
            if heading:
                in_gaps = len(heading[1]) == 2 and heading[2].strip().lower() == GAPS_SECTION
            if in_gaps and line.strip().startswith('|'):
                cells = docmd.split_row(line)
                lowered = [cell.lower() for cell in cells]
                if 'id' in lowered and 'question' in lowered:
                    id_column = lowered.index('id')
                elif id_column is not None and id_column < len(cells):
                    draft = docmd.uncode(cells[id_column]).strip()
                    ident = replacements.get(draft)
                    if ident is not None:
                        if ident in seen:
                            continue
                        seen.add(ident)
        lines.append(line)
    return ''.join(lines)


def assign_gap_ids(text, scope, previous=None):
    """Normalize the specification and all its inline gap references in one simultaneous pass."""
    rows = checked_gaps(text)
    unique = {}
    for row in rows:
        unique.setdefault(gap_identity(row), {key: value for key, value in row.items() if key != 'id'})
    records = [(payload, key, key) for key, payload in unique.items()]
    identified, ledger = refs.allocate('GAP', scope, records, previous)
    by_key = {gap_identity(row): row['id'] for row in identified}
    replacements = {row['id']: by_key[gap_identity(row)] for row in rows}
    text = _deduplicate_rows(text, replacements)
    # One pass also handles swaps between draft numbers and persisted numbers.
    text = GAP_REFERENCE.sub(lambda match: replacements.get(match.group(0), match.group(0)), text)
    return text, ledger
