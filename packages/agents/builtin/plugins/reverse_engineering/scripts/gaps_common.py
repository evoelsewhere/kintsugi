"""The gaps of a specification (ADR-0057): the `## Gaps and questions` table every AS-IS specification ends with.

One parser for `finish_items.py` (the count and the report of a table that does not read) and
`rebuild_aggregates.py` (the application's `_generated/GAPS.md`). The reader `hooks/reader/gaps.ts` parses the same
table in the portal and the API; both are held to the shared fixtures in `scripts/tests/fixtures/gaps/`.
Standard library only.
"""
import re

import docmd

GAP_ID = re.compile(r'^GAP-[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,}$')
GAP_KINDS = ('missing-source', 'unresolved', 'ambiguous', 'unverified')
GAP_IMPACTS = ('blocking', 'risk', 'note')
GAPS_SECTION = 'gaps and questions'


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
            problems.append(f'{ident[:40]} is not a gap id (GAP-<module>.<unit>-NN)')
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
