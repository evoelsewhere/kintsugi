"""Gap resolutions live in the original specification table, never a separate answer file.
Shared verbatim by both plugins; keep parity with hooks/reader/gaps.ts.
"""
import re
import docmd

# Who or what can settle a gap (ADR-0087), the optional `Settled by` column. It advises, it never makes a table invalid:
# a row without one, or with a value outside the list, takes its kind's default.
GAP_SETTLERS = ('source-owner', 'expert', 'data', 'check')
DEFAULT_SETTLER = {'missing-source': 'source-owner', 'unresolved': 'data', 'ambiguous': 'expert', 'unverified': 'check'}


def settler(row):
    """The `Settled by` of a gap row: its own value when it is one of GAP_SETTLERS, else the default of its kind."""
    value = (row.get('settled by') or '').strip()
    return value if value in GAP_SETTLERS else DEFAULT_SETTLER.get(row.get('kind', ''), 'expert')


def meaningful(value):
    return isinstance(value, str) and not re.fullmatch(r'(?:\s*|[-—]|todo\b.*|tbd\b.*|none\.?)', value.strip(), re.IGNORECASE)


def resolved(row):
    return row.get('status') == 'resolved' and meaningful(row.get('answer')) and meaningful(row.get('evidence'))


def inspect(text):
    sections = [body for title, body in docmd.sections(text, 2) if title.strip().lower() == 'gaps and questions']
    if len(sections) != 1:
        return [], ['Specification needs exactly one Gaps and questions section; run understand or repair the specification.']
    body = sections[0]
    tables = docmd.tables_in(body)
    references = set(re.findall(r'(?<![A-Za-z0-9._-])GAP-[A-Za-z0-9][A-Za-z0-9._-]*-[0-9]{2,}(?![A-Za-z0-9_-])', text))
    if not tables and body.strip().lower() == 'none.':
        return [], ['Gap reference has no table row: ' + ', '.join(sorted(references))] if references else []
    if len(tables) != 1 or not {'id', 'kind', 'question', 'where', 'impact'}.issubset({name.lower() for name in tables[0][0]}):
        return [], ['Gaps table needs ID, Kind, Question, Where and Impact columns.']
    rows, problems, seen = docmd.records_in(body), [], set()
    if len({name.lower() for name in tables[0][0]}) != len(tables[0][0]):
        problems.append('Gaps table has duplicate columns.')
    for row in rows:
        ident = docmd.uncode(row.get('id', '')).strip()
        if not re.fullmatch(r'GAP-[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,}', ident) or ident in seen:
            problems.append(f'Invalid or duplicate gap ID: {ident}')
        seen.add(ident)
        if row.get('kind') not in ('missing-source', 'unresolved', 'ambiguous', 'unverified') or row.get('impact') not in ('blocking', 'risk', 'note') or not row.get('question', '').strip() or not row.get('where', '').strip():
            problems.append(f'{ident}: invalid kind, impact, question or evidence location')
        status = row.get('status', '').strip()
        if status not in ('', 'open', 'resolved'):
            problems.append(f'{ident}: status must be open or resolved')
        if status == 'resolved' and not resolved(row):
            problems.append(f'{ident}: a resolution needs an answer and evidence')
    if references - seen:
        problems.append('Gap reference has no table row: ' + ', '.join(sorted(references - seen)))
    for cells in tables[0][1]:
        if len(cells) != len(tables[0][0]):
            problems.append('Gap row has the wrong number of columns')
    return rows, problems
