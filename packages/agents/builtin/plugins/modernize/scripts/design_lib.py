"""Design sets (ADR-0044, ADR-0045): read a project's templates and check a unit's design against them.

A set is `standards/design/<set>/set.md` (identity in the front matter, its documents in a table) and one
template file per document. A template is Markdown; under a heading, an HTML comment holds that section's
contract, one directive per line: `required`, `table: A | B`, `seed: rules`, `check: name(args)` (repeatable)
and `guidance: text`.

This is the member-side copy of `hooks/reader/design.ts` in the reverse_engineering plugin, which the API runs.
Both are held to the fixtures in `scripts/tests/fixtures/design/`, so every message below is written exactly as
the TypeScript side writes it. Standard library only.
"""
import os
import re

import docmd
import paths

DESIGN_CHECKS = ('no-placeholder', 'covers-rules', 'refs-resolve', 'id-pattern', 'max-length', 'one-of')
DESIGN_SEEDS = ('rules',)
REFERENCE_SOURCES = ('rules', 'requirements', 'components')
TEMPLATE_VARIABLES = ('unit.id', 'unit.title', 'app.id', 'kind', 'set.id', 'set.version')
SET_ID = re.compile(r'^[a-z][a-z0-9-]{0,39}$')
TEMPLATE_REF = re.compile(r'^([a-z][a-z0-9-]{0,39})@([1-9][0-9]{0,8})$')
FILE_PATH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\.md$')
PLACEHOLDER = re.compile(r'\b(?:TODO|TBD)\b', re.ASCII)
SKIPPED_TOKENS = {'-', '\u2014', '\u2013', 'n/a', 'N/A', 'TODO', 'TBD'}
SHOWN = 10
MAX_LINE = 4000
DESIGN_PREFIX = paths.design_sets_dir()


# ---------------------------------------------------------------------------
# Text helpers, the same normalisation as the TypeScript reader

def cell_text(value):
    """Bold markers and `<br>` removed, whitespace collapsed."""
    text = value.replace('**', '')
    text = re.sub(r'<br\s*/?>', ' ', text, flags=re.I)
    return re.sub(r'\s+', ' ', text).strip()


def norm(value):
    return cell_text(value).lower()


def lines_of(text):
    return [line[:MAX_LINE] for line in text.split('\n')]


def clean_source(text):
    return text.lstrip('\ufeff').replace('\r\n', '\n')


def strip_comments(text):
    return re.sub(r'<!--.*?-->', '', text, flags=re.S)


def unique(items):
    return list(dict.fromkeys(items))


def shown(items):
    head = ', '.join(items[:SHOWN])
    return f'{head} and {len(items) - SHOWN} more' if len(items) > SHOWN else head


def at(row, index):
    return row[index] if 0 <= index < len(row) else ''


def has_front_matter(text):
    lines = lines_of(clean_source(text))
    return bool(lines) and lines[0].strip() == '---' and any(line.strip() == '---' for line in lines[1:])


def front_of(text):
    """(fields, body) or None when the document has no front matter."""
    if not has_front_matter(text):
        return None
    fields, body = docmd.split_front_matter(clean_source(text))
    return fields, body.strip()


# ---------------------------------------------------------------------------
# Tables, as the TypeScript `tablesIn` reads them

def _cells(line):
    trimmed = line.strip()
    trimmed = trimmed[1:] if trimmed.startswith('|') else trimmed
    trimmed = trimmed[:-1] if trimmed.endswith('|') else trimmed
    cells, current, code, index = [], '', False, 0
    while index < len(trimmed):
        char = trimmed[index]
        if char == '\\' and index + 1 < len(trimmed) and trimmed[index + 1] == '|':
            current += '|'
            index += 2
            continue
        if char == '`':
            code = not code
            current += char
        elif char == '|' and not code:
            cells.append(cell_text(current))
            current = ''
        else:
            current += char
        index += 1
    cells.append(cell_text(current))
    return cells


def _is_delimiter(line):
    return bool(re.match(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$', line))


def tables_in(text):
    """Every GFM table of the text, in order: {'header': [...], 'rows': [[...]]}."""
    lines = lines_of(text)
    tables, i = [], 0
    while i + 1 < len(lines):
        head = lines[i]
        if not head.strip().startswith('|') or not _is_delimiter(lines[i + 1]):
            i += 1
            continue
        rows, j = [], i + 2
        while j < len(lines) and lines[j].strip().startswith('|'):
            rows.append(_cells(lines[j]))
            j += 1
        tables.append({'header': _cells(head), 'rows': rows})
        i = j
    return tables


def column_cells(table, column):
    index = next((i for i, cell in enumerate(table['header']) if norm(cell) == column.lower()), -1)
    return [] if index < 0 else [at(row, index).replace('`', '').strip() for row in table['rows']]


def has_column(table, column):
    return any(norm(cell) == column.lower() for cell in table['header'])


def tokens_of(cell):
    return [token.strip() for token in re.split(r'[\s,;]+', cell.replace('`', '')) if token.strip()]


# ---------------------------------------------------------------------------
# Reading a template

def headings_of(lines):
    found, fenced = [], False
    for index, line in enumerate(lines):
        if re.match(r'^\s*(```|~~~)', line):
            fenced = not fenced
            continue
        match = None if fenced else re.match(r'^(#{1,6})\s+(.+?)\s*#*\s*$', line)
        if match:
            found.append({'level': len(match.group(1)), 'title': cell_text(match.group(2)), 'line': index})
    return found


def directive_block(lines, start, end):
    """The lines of the comment right under a heading, or None when the heading carries none."""
    index = start
    while index < end and lines[index].strip() == '':
        index += 1
    if index >= end or not lines[index].strip().startswith('<!--'):
        return None
    collected, current = [], lines[index].strip()[4:]
    while True:
        close = current.find('-->')
        if close >= 0:
            collected.append(current[:close])
            return [line.strip() for line in collected if line.strip()]
        collected.append(current)
        index += 1
        if index >= end:
            return [line.strip() for line in collected if line.strip()]
        current = lines[index]


def _check_of(value, problems, heading):
    match = re.match(r'^([a-z-]+)(?:\((.*)\))?$', value.strip())
    name = match.group(1) if match else ''
    args = (match.group(2) or '').strip() if match else ''
    if not match or name not in DESIGN_CHECKS:
        problems.append(f'section "{heading}": unknown check "{value.strip()}"')
        return None

    def needs(what):
        problems.append(f'section "{heading}": check "{name}" needs {what}')
        return None

    if name == 'no-placeholder':
        return {'name': name}
    if name == 'covers-rules':
        return needs('a column') if args == '' else {'name': name, 'column': args}
    if name == 'refs-resolve':
        arrow = args.find('->')
        column = '' if arrow < 0 else args[:arrow].strip()
        source = '' if arrow < 0 else args[arrow + 2:].strip()
        if column == '' or source == '':
            return needs('a column and a source: refs-resolve(Column -> source)')
        return {'name': name, 'column': column, 'source': source}
    if name == 'id-pattern':
        comma = args.find(',')
        column = '' if comma < 0 else args[:comma].strip()
        pattern = '' if comma < 0 else args[comma + 1:].strip()
        if column == '' or pattern == '':
            return needs('a column and a pattern: id-pattern(Column, pattern)')
        return {'name': name, 'column': column, 'pattern': pattern}
    if name == 'max-length':
        return {'name': name, 'limit': int(args)} if re.match(r'^[1-9][0-9]{0,8}$', args) else needs('a positive number')
    comma = args.find(',')
    column = '' if comma < 0 else args[:comma].strip()
    options = [] if comma < 0 else [option.strip() for option in args[comma + 1:].split('|') if option.strip()]
    if column == '' or not options:
        return needs('a column and options: one-of(Column, a|b|c)')
    return {'name': 'one-of', 'column': column, 'options': options}


def parse_template(text):
    """(sections, problems): the headings that carry a directive block, and the faults of the template itself."""
    lines = lines_of(clean_source(text))
    headings = headings_of(lines)
    sections, problems = [], []
    for name in unique(re.findall(r'\{\{\s*([^{}]*?)\s*\}\}', text)):
        if name not in TEMPLATE_VARIABLES:
            problems.append(f'unknown variable "{{{{{name}}}}}"')
    for position, heading in enumerate(headings):
        following = headings[position + 1]['line'] if position + 1 < len(headings) else len(lines)
        block = directive_block(lines, heading['line'] + 1, following)
        if block is None:
            continue
        section = {'heading': heading['title'], 'level': heading['level'], 'required': False, 'table': None, 'seed': None, 'checks': [], 'guidance': None}
        where = f'section "{heading["title"]}"'
        if any(norm(known['heading']) == norm(heading['title']) for known in sections):
            problems.append(f'{where} is listed twice')
        for line in block:
            if line == 'required':
                section['required'] = True
                continue
            pair = re.match(r'^(table|seed|check|guidance):\s*(.*)$', line)
            if not pair:
                problems.append(f'{where}: unknown directive "{line}"')
                continue
            key, value = pair.group(1), pair.group(2).strip()
            if key == 'table':
                columns = [column.strip() for column in value.split('|')]
                if any(column == '' for column in columns):
                    problems.append(f'{where}: table must name its columns separated by |')
                elif len({column.lower() for column in columns}) != len(columns):
                    problems.append(f'{where}: table names a column twice')
                else:
                    section['table'] = columns
            elif key == 'seed':
                if value in DESIGN_SEEDS:
                    section['seed'] = value
                else:
                    problems.append(f'{where}: unknown seed "{value}"')
            elif key == 'check':
                check = _check_of(value, problems, heading['title'])
                if check is not None:
                    section['checks'].append(check)
            else:
                section['guidance'] = value
        if section['seed'] is not None and section['table'] is None:
            problems.append(f'{where}: seed "{section["seed"]}" needs a table')
        for check in section['checks']:
            if check['name'] in ('no-placeholder', 'max-length'):
                continue
            if section['table'] is None:
                problems.append(f'{where}: check "{check["name"]}" needs a table in the section')
            elif not any(column.lower() == check['column'].lower() for column in section['table']):
                problems.append(f'{where}: check "{check["name"]}": column "{check["column"]}" is not in the section\'s table')
            if check['name'] == 'id-pattern':
                try:
                    re.compile(f'(?:{check["pattern"]})')
                except re.error:
                    problems.append(f'{where}: id-pattern "{check["pattern"]}" is not a valid pattern')
        sections.append(section)
    return sections, problems


# ---------------------------------------------------------------------------
# Reading set.md

def _string_list(value):
    if value is None or value == '':
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return [item.strip() for item in value if item.strip()]
    return None


def parse_set(text, folder):
    """(set or None, problems): `set` is None when the file cannot give a usable identity."""
    problems = []
    front = front_of(text)
    if front is None:
        return None, ['has no front matter']
    data, body = front
    id_ = data.get('id').strip() if isinstance(data.get('id'), str) else ''
    title = data.get('title').strip() if isinstance(data.get('title'), str) else ''
    version = data.get('version')
    applies_to = _string_list(data.get('appliesTo'))
    needs = _string_list(data.get('needs'))
    version_ok = isinstance(version, int) and not isinstance(version, bool) and version >= 1
    if not SET_ID.match(id_):
        problems.append('id is missing or not a lowercase name (letters, digits, hyphens)')
    elif id_ != folder:
        problems.append(f'id "{id_}" does not match its folder "{folder}"')
    if title == '':
        problems.append('title is missing')
    if not version_ok:
        problems.append('version must be a positive integer')
    if applies_to is None:
        problems.append('appliesTo must be a list of unit kinds')
    if needs is None:
        problems.append('needs must be a list of set ids')
    stage = data.get('stage').strip() if isinstance(data.get('stage'), str) and data.get('stage').strip() else None
    files = []
    table = next((t for t in tables_in(body) if any(norm(c) == 'path' for c in t['header']) and any(norm(c) == 'template' for c in t['header'])), None)
    if table is None:
        problems.append('has no files table (columns Path | Template | Required | When)')
    else:
        def column(name):
            return next((i for i, cell in enumerate(table['header']) if norm(cell) == name), -1)
        path_at, template_at, required_at, when_at = column('path'), column('template'), column('required'), column('when')
        for row in table['rows']:
            path = at(row, path_at).replace('`', '').strip()
            template = at(row, template_at).replace('`', '').strip()
            required = norm(at(row, required_at))
            where = f'file "{path}"'
            if not FILE_PATH.match(path) or '..' in path.split('/'):
                problems.append(f'{where}: path must be a relative .md path with no ".."')
                continue
            if any(known['path'] == path for known in files):
                problems.append(f'{where} is listed twice')
                continue
            if required not in ('yes', 'no'):
                problems.append(f'{where}: Required must be yes or no')
            when = [] if when_at < 0 else [kind.replace('`', '').strip() for kind in re.split(r'[,\s]+', at(row, when_at)) if kind.replace('`', '').strip()]
            files.append({'path': path, 'template': template, 'required': required == 'yes', 'when': when})
        if not table['rows']:
            problems.append('has no files table (columns Path | Template | Required | When)')
    if not SET_ID.match(id_) or not version_ok or title == '' or applies_to is None or needs is None:
        return None, problems
    description = '\n'.join(line for line in body.split('\n') if not line.strip().startswith(('|', '#'))).strip()
    result = {'id': id_, 'title': title, 'version': version, 'appliesTo': applies_to, 'needs': needs, 'stage': stage, 'files': files, 'description': description}
    return result, problems


def files_for(set_, kind):
    """The files of a set that a unit of `kind` needs; none when the set is not for that kind."""
    if set_['appliesTo'] and kind not in set_['appliesTo']:
        return []
    return [f for f in set_['files'] if not f['when'] or kind in f['when']]


def load_sets(sources, unit_kinds=None):
    """(sets, problems): every set of the project and the faults of their definitions.

    `sources` is a list of {'folder', 'set_text' (None when set.md is missing), 'templates': {file name: text}}.
    A set that cannot give a usable identity is left out; the others are returned, with their problems listed."""
    problems, sets = [], []

    def report(path, message):
        problems.append({'path': path, 'message': message})

    for source in sorted(sources, key=lambda s: s['folder']):
        folder = source['folder']
        set_path = f'{DESIGN_PREFIX}/{folder}/set.md'
        if source['set_text'] is None:
            report(set_path, 'is missing')
            continue
        read, read_problems = parse_set(source['set_text'], folder)
        for message in read_problems:
            report(set_path, message)
        if read is None:
            continue
        templates = {}
        for file in read['files']:
            template_path = f'{DESIGN_PREFIX}/{folder}/{file["template"]}'
            text = source['templates'].get(file['template'])
            if text is None:
                report(set_path, f'file "{file["path"]}": template "{file["template"]}" does not exist in the set folder')
                continue
            if file['template'] in templates:
                continue
            sections, template_problems = parse_template(text)
            templates[file['template']] = {'sections': sections}
            for message in template_problems:
                report(template_path, message)
            for section in sections:
                for check in section['checks']:
                    if check['name'] == 'refs-resolve' and check['source'] not in REFERENCE_SOURCES and check['source'] not in read['needs']:
                        report(template_path, f'section "{section["heading"]}": refs-resolve source "{check["source"]}" is not rules, requirements, components or a set in needs')
        for kind in read['appliesTo']:
            if unit_kinds is not None and kind not in unit_kinds:
                report(set_path, f'unit kind "{kind}" in appliesTo is not declared in unitKinds')
        for file in read['files']:
            for kind in file['when']:
                if read['appliesTo']:
                    if kind not in read['appliesTo']:
                        report(set_path, f'file "{file["path"]}": kind "{kind}" in When is not one the set applies to')
                elif unit_kinds is not None and kind not in unit_kinds:
                    report(set_path, f'file "{file["path"]}": kind "{kind}" in When is not declared in unitKinds')
        sets.append({'set': read, 'templates': templates})
    known = {loaded['set']['id'] for loaded in sets}
    needs_of = {loaded['set']['id']: loaded['set']['needs'] for loaded in sets}
    for loaded in sets:
        for need in loaded['set']['needs']:
            if need not in known:
                report(f'{DESIGN_PREFIX}/{loaded["set"]["id"]}/set.md', f'needs "{need}" is not a set of this project')
    for loaded in sets:
        own = loaded['set']['id']
        seen = set()

        def walk(identifier):
            for need in needs_of.get(identifier, []):
                if need == own:
                    return True
                if need not in seen:
                    seen.add(need)
                    if walk(need):
                        return True
            return False
        if walk(own):
            report(f'{DESIGN_PREFIX}/{own}/set.md', f'needs makes a cycle that includes "{own}"')
    return sets, problems


# ---------------------------------------------------------------------------
# Checking a design document against its template

def template_ref_of(text):
    front = front_of(text)
    value = front[0].get('template') if front else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def is_stale(text, set_):
    """Whether the design was written against an older version of its set."""
    ref = template_ref_of(text)
    match = TEMPLATE_REF.match(ref) if ref else None
    return bool(match) and match.group(1) == set_['id'] and int(match.group(2)) < set_['version']


def item_ids(text):
    """The ids a design offers as design items: the cells of every `ID` column of its tables."""
    ids = []
    for table in tables_in(strip_comments(text)):
        for value in column_cells(table, 'id'):
            if value != '' and value not in SKIPPED_TOKENS:
                ids.append(value)
    return unique(ids)


def _content_of(lines, headings, position):
    heading = headings[position]
    end = next((h['line'] for h in headings[position + 1:] if h['level'] <= heading['level']), len(lines))
    return strip_comments('\n'.join(lines[heading['line'] + 1:end])).strip()


def check_document(template, set_, text, context):
    """The faults of one design document against its template and set, as {'code', 'section', 'message'}; none means it conforms.

    `context` carries ruleIds, requirementIds, componentIds and `items`: the id of a set to the design items of the unit in it."""
    problems = []
    ref = template_ref_of(text)
    if ref is None:
        problems.append({'code': 'missing-template-ref', 'message': 'front matter has no template reference (template: <set>@<version>)'})
    else:
        match = TEMPLATE_REF.match(ref)
        if not match or match.group(1) != set_['id']:
            problems.append({'code': 'wrong-template-ref', 'message': f'template reference "{ref}" does not name this set (expected {set_["id"]}@{set_["version"]})'})
    front = front_of(text)
    body = front[1] if front else text
    lines = lines_of(clean_source(body))
    headings = headings_of(lines)
    for section in template['sections']:
        position = next((i for i, h in enumerate(headings) if norm(h['title']) == norm(section['heading'])), -1)

        def fail(code, message, heading=section['heading']):
            problems.append({'code': code, 'section': heading, 'message': message})
        if position < 0:
            if section['required']:
                fail('missing-section', f'missing section "{section["heading"]}"')
            continue
        content = _content_of(lines, headings, position)
        tables = tables_in(content) if section['table'] is not None else []
        table = tables[0] if tables else None
        if section['table'] is not None:
            expected = ' | '.join(section['table'])
            if table is None:
                if section['required'] or content != '':
                    fail('missing-table', f'no table; expected columns: {expected}')
            else:
                found = [norm(cell) for cell in table['header']]
                if len(found) != len(section['table']) or any(cell != section['table'][i].lower() for i, cell in enumerate(found)):
                    fail('table-columns', f'columns "{" | ".join(table["header"])}" do not match "{expected}"')
                elif section['required'] and all(all(cell.strip() == '' for cell in row) for row in table['rows']):
                    fail('empty-section', 'section is empty')
        elif section['required'] and content == '':
            fail('empty-section', 'section is empty')

        def usable(column):
            return table if table is not None and has_column(table, column) else None

        def cells_of(column):
            found = usable(column)
            return [] if found is None else column_cells(found, column)
        for check in section['checks']:
            name = check['name']
            if name == 'no-placeholder':
                found = unique(PLACEHOLDER.findall(content))
                if found:
                    fail('placeholder', f'unfinished text left: {", ".join(found)}')
            elif name == 'max-length':
                if len(content) > check['limit']:
                    fail('too-long', f'section has {len(content)} characters; the limit is {check["limit"]}')
            elif name == 'covers-rules':
                covered = {token for cell in cells_of(check['column']) for token in tokens_of(cell)}
                missing = [rule for rule in context['ruleIds'] if rule not in covered]
                if usable(check['column']) is not None and missing:
                    fail('uncovered-rules', f'rules without a design item: {shown(missing)}')
            elif name == 'refs-resolve':
                source = check['source']
                known = set(context['ruleIds'] if source == 'rules' else context['requirementIds'] if source == 'requirements'
                            else context['componentIds'] if source == 'components' else context['items'].get(source, []))
                loose = unique([token for cell in cells_of(check['column']) for token in tokens_of(cell) if token not in SKIPPED_TOKENS and token not in known])
                if loose:
                    fail('unresolved-reference', f'references that do not resolve to {source}: {shown(loose)}')
            elif name == 'id-pattern':
                pattern = re.compile(f'(?:{check["pattern"]})')
                wrong = unique([cell for cell in cells_of(check['column']) if cell != '' and cell not in SKIPPED_TOKENS and not pattern.fullmatch(cell)])
                if wrong:
                    fail('id-pattern', f'values that do not match {check["pattern"]}: {shown(wrong)}')
            else:
                options = {option.lower() for option in check['options']}
                wrong = unique([cell for cell in cells_of(check['column']) if cell != '' and cell not in SKIPPED_TOKENS and cell.lower() not in options])
                if wrong:
                    fail('not-allowed', f'values not among {"|".join(check["options"])}: {shown(wrong)}')
    return problems


# ---------------------------------------------------------------------------
# Reading a document repository (the working directory of the member's harness)

WAIVER = re.compile(r'^([a-z][a-z0-9-]{0,39})/([^:\s][^:]*?):\s*(.+)$')
REQUIREMENT_HEADING = re.compile(r'^#{2,6}\s+(REQ-[A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*(?:[\u2014\u2013:-]\s*|\s+)(.*))?\s*$')
COMPONENT_ID = re.compile(r'^COM-[A-Z0-9][A-Z0-9-]{0,38}$')
UNIT_KEY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')


def _real_dir(path):
    return os.path.isdir(path) and not os.path.islink(path)


def _real_file(path):
    return os.path.isfile(path) and not os.path.islink(path)


def read_sources(root):
    """The sets under `standards/design/` of the repository at `root`, as `load_sets` takes them."""
    base = os.path.join(root, *paths.design_sets_dir().split('/'))
    sources = []
    if not _real_dir(base):
        return sources
    for folder in sorted(os.listdir(base)):
        directory = os.path.join(base, folder)
        if not _real_dir(directory):
            continue
        files = [name for name in sorted(os.listdir(directory)) if name.endswith('.md') and _real_file(os.path.join(directory, name))]
        sources.append({'folder': folder,
                        'set_text': docmd.read_text(os.path.join(directory, 'set.md')) if 'set.md' in files else None,
                        'templates': {name: docmd.read_text(os.path.join(directory, name)) for name in files if name != 'set.md'}})
    return sources


def parse_waivers(values):
    """{(set, file): reason} from the `waived` list of a unit.md."""
    out = {}
    for value in docmd.as_list(values):
        match = WAIVER.match(str(value).strip())
        if match:
            out[(match.group(1), match.group(2).strip())] = match.group(3).strip()
    return out


def read_unit(root, app, unit_key):
    """{'kind', 'title', 'waived'} of a unit from its unit.md; raises DataError when the unit has none."""
    if not UNIT_KEY.match(unit_key):
        raise docmd.DataError(f'"{unit_key}" is not a unit key (<module>/<unit>)')
    module, unit = paths.split_unit_key(unit_key)
    relative = paths.unit_state_path(app, module, unit)
    path = os.path.join(root, *relative.split('/'))
    if not _real_file(path):
        raise docmd.DataError(f'{relative} does not exist: understand the unit first')
    data, _ = docmd.split_front_matter(docmd.read_text(path))
    kind = data.get('kind') if isinstance(data.get('kind'), str) else ''
    if kind == '':
        raise docmd.DataError(f'{relative} has no kind in its front matter')
    title = data.get('title') if isinstance(data.get('title'), str) and data.get('title').strip() else unit
    return {'kind': kind, 'title': title, 'waived': parse_waivers(data.get('waived'))}


def rules_of(root, app, unit_key):
    """[(id, title)] of the rules the unit's understanding documents: the rows of the rules table of rules.md
    (retired rules left out), or the older `### <id>: <title>` cards."""
    module, unit = paths.split_unit_key(unit_key)
    path = os.path.join(root, *paths.unit_rules_path(app, module, unit).split('/'))
    if not _real_file(path):
        return []
    text = docmd.read_text(path)
    listed = [(row['id'], row.get('name', '')) for row in docmd.records_in(docmd.split_front_matter(text)[1]) if row.get('id', '').startswith('RULE-') and row.get('status') != 'retired']
    if listed:
        return listed
    rules = []
    for title, _ in docmd.sections(text, 3):
        ident, rest = docmd.split_heading(title)
        if ident:
            rules.append((ident, rest))
    return rules


def requirement_ids(root, app):
    path = os.path.join(root, *paths.application_requirements_path(app).split('/'))
    if not _real_file(path):
        return []
    found = []
    for line in docmd.read_text(path).split('\n'):
        match = REQUIREMENT_HEADING.match(line)
        if match:
            found.append(match.group(1))
    return found


def component_ids(root):
    base = os.path.join(root, *paths.common_components_dir().split('/'))
    if not _real_dir(base):
        return []
    return sorted(name[:-3] for name in os.listdir(base) if name.endswith('.md') and COMPONENT_ID.match(name[:-3]))


def unit_items(root, app, unit_key, sets):
    """{set id: design item ids} of the unit's documents in each set that exists on disk."""
    module, unit = paths.split_unit_key(unit_key)
    items = {}
    for loaded in sets:
        directory = os.path.join(root, *paths.unit_design_set_dir(app, module, unit, loaded['set']['id']).split('/'))
        found = []
        for file in loaded['set']['files']:
            path = os.path.join(directory, *file['path'].split('/'))
            if _real_file(path):
                found.extend(item_ids(docmd.read_text(path)))
        items[loaded['set']['id']] = unique(found)
    return items


def unit_context(root, app, unit_key, sets):
    """What the ids a unit's design points to are checked against."""
    return {'ruleIds': [ident for ident, _ in rules_of(root, app, unit_key)], 'requirementIds': requirement_ids(root, app),
            'componentIds': component_ids(root), 'items': unit_items(root, app, unit_key, sets)}


# ---------------------------------------------------------------------------
# Scaffolding a document from its template

def _section_lines(section, rules):
    if section['table'] is None:
        return ['', 'TODO', ''] if section['required'] else ['']
    columns = section['table']
    seeded = next((i for i, column in enumerate(columns)
                   if any(check['name'] == 'covers-rules' and check['column'].lower() == column.lower() for check in section['checks'])), 0)
    rows = []
    if section['seed'] == 'rules':
        for ident, _ in rules:
            row = ['TODO'] * len(columns)
            row[seeded] = ident
            rows.append(row)
    if not rows and section['required']:
        rows = [['TODO'] * len(columns)]
    return ['', *docmd.table(columns, rows).rstrip('\n').split('\n'), '']


def scaffold_text(template_text, sections, set_, unit_id, title, app, kind, rules):
    """The first draft of one design document: the template with its directive blocks replaced by what an author fills in.

    A section keeps its heading; its table (seeded with the unit's rules when the template says so) or a `TODO` replaces
    what the template holds under it, since the guidance lives in the directive. Text under other headings is kept."""
    lines = lines_of(clean_source(template_text))
    headings = headings_of(lines)
    out, cursor = [], 0
    for position, heading in enumerate(headings):
        following = headings[position + 1]['line'] if position + 1 < len(headings) else len(lines)
        if directive_block(lines, heading['line'] + 1, following) is None:
            continue
        section = next(s for s in sections if norm(s['heading']) == norm(heading['title']))
        out.extend(lines[cursor:heading['line'] + 1])
        out.extend(_section_lines(section, rules))
        cursor = following
    out.extend(lines[cursor:])
    variables = {'unit.id': unit_id, 'unit.title': title, 'app.id': app, 'kind': kind, 'set.id': set_['id'], 'set.version': str(set_['version'])}
    body = re.sub(r'\{\{\s*([^{}]*?)\s*\}\}', lambda match: variables.get(match.group(1), match.group(0)), '\n'.join(out))
    body = re.sub(r'\n{3,}', '\n\n', body).strip('\n')
    return docmd.front_matter({'template': f'{set_["id"]}@{set_["version"]}', 'unit': unit_id}) + body + '\n'
