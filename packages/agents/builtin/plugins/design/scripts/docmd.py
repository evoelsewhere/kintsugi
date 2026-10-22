"""Markdown documents of the document repository, as the scripts of this plugin write and read them
(docs/reference/document-formats.md). The repository holds no JSON: what a script publishes is
front matter, tables and cards, so a person and a model read it the same way.

    ---                          front matter: scalars and short lists, JSON-quoted strings
    app: "billing-web"
    items: 12
    languages:
      - "Java"
    ---
    # Title
    | Language | Files |          tables: one record per row, `|` escaped as `\\|`
    | --- | --- |
    ### invoicing/entry: Invoice entry      cards: a heading `id: title`, prose, then field bullets
    - **kind:** screen
    - **files:**
      - `src/a.java`
    #### Depends on                         and subsections whose body is a table or a list

Standard library only. Not a script on its own; shared by the scripts, identical in every plugin
that has it.
"""
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True

MAX_TEXT_BYTES = 16_000_000


class DataError(ValueError):
    """Invalid, oversized or unsafe input."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

def read_text(path, what=None, limit=MAX_TEXT_BYTES):
    name = what or os.path.basename(path)
    if os.path.islink(path):
        raise DataError(f'refusing to read through a symbolic link: {name}')
    if os.path.getsize(path) > limit:
        raise DataError(f'{name} exceeds the {limit}-byte limit')
    with open(path, 'rb') as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise DataError(f'{name} exceeds the {limit}-byte limit')
    return data.decode('utf-8-sig', errors='replace').replace('\r\n', '\n')


def read_optional_text(path, what=None):
    """The text of the file, or None when the path is not given or not a file."""
    if not path or not os.path.isfile(path):
        return None
    return read_text(path, what)


def read_json(path, what=None, limit=MAX_TEXT_BYTES):
    """A scratch or workflow JSON file (job-to-job data, never committed)."""
    name = what or os.path.basename(path)
    try:
        return json.loads(read_text(path, name, limit))
    except json.JSONDecodeError as error:
        raise DataError(f'{name} is not valid JSON: {error.__class__.__name__}') from error


def write_text(path, text):
    """Writes the text atomically with LF line ends and one final newline."""
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    temporary = path + '.tmp'
    if os.path.islink(path) or os.path.islink(temporary):
        raise DataError(f'refusing to write through a symbolic link: {os.path.basename(path)}')
    body = text if text.endswith('\n') else text + '\n'
    if len(body.encode('utf-8')) > MAX_TEXT_BYTES:
        raise DataError(f'{os.path.basename(path)} exceeds the {MAX_TEXT_BYTES}-byte limit')
    with open(temporary, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(body)
    # Windows transiently denies the replace while a scanner holds the new file: retry briefly.
    for attempt in range(20):
        try:
            os.replace(temporary, path)
            return
        except OSError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def write_json(path, value):
    """A scratch JSON file: job-to-job data that is not part of the document repository."""
    write_text(path, json.dumps(value, indent=1, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean_text(value, limit):
    """A single-line, bounded, printable string ('' for anything else)."""
    if not isinstance(value, str):
        return ''
    text = ''.join(ch if ch.isprintable() else ' ' for ch in value)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def slug(text, fallback='item'):
    value = re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-')[:60].strip('-')
    return value or fallback


def norm_path(value):
    """A repository-relative POSIX path, or None when it is empty, absolute or climbs out."""
    if not isinstance(value, str) or not value or '\x00' in value:
        return None
    path = os.path.normpath(value.replace('\\', '/')).replace('\\', '/')
    if path.startswith('/') or path == '..' or path.startswith('../') or path == '.':
        return None
    return path


def manifest_unit_kinds(manifest):
    """`unitKinds` of kintsugi.yaml (flow list or block list); [] when absent."""
    if not manifest or not os.path.isfile(manifest):
        return []
    lines = read_text(manifest, limit=5_000_000).splitlines()
    for index, line in enumerate(lines):
        match = re.match(r'^unitKinds:\s*(.*)$', line)
        if not match:
            continue
        rest = match.group(1).split('#', 1)[0].strip()
        if rest.startswith('['):
            return [item.strip().strip('\'"') for item in rest.strip('[]').split(',') if item.strip()]
        kinds = []
        for following in lines[index + 1:]:
            item = re.match(r'^\s+-\s*([^#]+)', following)
            if not item:
                break
            kinds.append(item.group(1).strip().strip('\'"'))
        return kinds
    return []


# ---------------------------------------------------------------------------
# Scalars and front matter
# ---------------------------------------------------------------------------

def scalar(value):
    """A value as front-matter text: strings are JSON-quoted (valid YAML), numbers and booleans plain."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return json.dumps(value)
    return json.dumps(re.sub(r'\s+', ' ', str(value)).strip(), ensure_ascii=False)


def scalar_list(values):
    """A list on one line, as a JSON array (valid YAML flow sequence)."""
    return json.dumps([re.sub(r'\s+', ' ', str(value)).strip() for value in values], ensure_ascii=False)


def parse_scalar(text):
    value = text.strip()
    if value == '':
        return None
    if re.match(r'^["\[{]|^-?\d|^(true|false|null)$', value):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    return re.sub(r"^'(.*)'$", r'\1', value)


def front_matter(fields):
    """`---` block of the fields, in order: a list is a block list, anything else one `key: value` line."""
    lines = ['---']
    for key, value in fields.items():
        if isinstance(value, (list, tuple)):
            if not value:
                lines.append(f'{key}: []')
            else:
                lines.append(f'{key}:')
                lines.extend(f'  - {scalar(item)}' for item in value)
        else:
            lines.append(f'{key}: {scalar(value)}')
    lines.append('---')
    return '\n'.join(lines) + '\n'


def split_front_matter(text):
    """(fields, body); ({}, text) when the document has no front matter."""
    lines = text.replace('\r\n', '\n').split('\n')
    if not lines or lines[0].strip() != '---':
        return {}, text
    end = next((index for index in range(1, len(lines)) if lines[index].strip() == '---'), -1)
    if end < 0:
        return {}, text
    data, parent = {}, None
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        item = re.match(r'^\s+-\s+(.*)$', line)
        if item and parent is not None:
            data[parent] = [*(data[parent] if isinstance(data[parent], list) else []), parse_scalar(item.group(1))]
            continue
        pair = re.match(r'^([A-Za-z0-9_-]+):\s*(.*)$', line)
        if not pair:
            parent = None
            continue
        key, value = pair.group(1), parse_scalar(pair.group(2))
        data[key] = value
        parent = key if value is None else None
    return data, '\n'.join(lines[end + 1:]).strip('\n')


def as_list(value):
    """A field value as a list: '' and None are empty, one string is a one-item list."""
    if value is None or value == '':
        return []
    if isinstance(value, list):
        return value
    return [value]


def as_int(value, default=0):
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r'-?\d+', value.strip()):
        return int(value.strip())
    return default


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def cell(value):
    """One table cell: a single line, `|` escaped, no unbalanced backtick."""
    text = re.sub(r'\s+', ' ', '' if value is None else str(value)).strip()
    if text.count('`') % 2:
        text = text.replace('`', "'")
    text = text.replace('|', '\\|')
    return text + ' ' if text.endswith('\\') else text


def table(headers, rows):
    """A GFM table; `rows` are sequences of values in the order of `headers`."""
    lines = ['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |']
    lines.extend('| ' + ' | '.join(cell(value) for value in row) + ' |' for row in rows)
    return '\n'.join(lines) + '\n'


def split_row(line):
    text = line.strip()
    if text.startswith('|'):
        text = text[1:]
    if text.endswith('|') and not text.endswith('\\|'):
        text = text[:-1]
    cells, current, code, index = [], '', False, 0
    while index < len(text):
        char = text[index]
        if char == '\\' and index + 1 < len(text) and text[index + 1] == '|':
            current += '|'
            index += 2
            continue
        if char == '`':
            code = not code
        if char == '|' and not code:
            cells.append(current.strip())
            current = ''
        else:
            current += char
        index += 1
    cells.append(current.strip())
    return cells


def _is_delimiter(line):
    return bool(re.match(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$', line))


def tables_in(text):
    """Every GFM table of the text as (header, rows), outside fenced code."""
    lines = text.split('\n')
    found, fenced, index = [], False, 0
    while index < len(lines):
        line = lines[index]
        if re.match(r'^\s*(```|~~~)', line):
            fenced = not fenced
        elif not fenced and line.strip().startswith('|') and index + 1 < len(lines) and _is_delimiter(lines[index + 1]):
            header = split_row(line)
            rows, cursor = [], index + 2
            while cursor < len(lines) and lines[cursor].strip().startswith('|'):
                rows.append(split_row(lines[cursor]))
                cursor += 1
            found.append((header, rows))
            index = cursor
            continue
        index += 1
    return found


def records_in(text, index=0):
    """The rows of the `index`th table of the text as dicts keyed by the lower-cased header."""
    found = tables_in(text)
    if index >= len(found):
        return []
    header, rows = found[index]
    keys = [name.lower() for name in header]
    return [dict(zip(keys, [*row, *([''] * (len(keys) - len(row)))])) for row in rows]


# ---------------------------------------------------------------------------
# Sections, cards and fields
# ---------------------------------------------------------------------------

def sections(text, level):
    """(title, body) of every heading of exactly `level`, outside fenced code. A body runs to the
    next heading of the same or a higher level, so deeper headings stay in it."""
    lines = text.replace('\r\n', '\n').split('\n')
    heads, fenced = [], False
    for index, line in enumerate(lines):
        if re.match(r'^\s*(```|~~~)', line):
            fenced = not fenced
            continue
        match = None if fenced else re.match(r'^(#{1,6})\s+(.+?)\s*#*\s*$', line)
        if match:
            heads.append((index, len(match.group(1)), match.group(2)))
    out = []
    for position, (index, depth, title) in enumerate(heads):
        if depth != level:
            continue
        end = next((later for later, later_depth, _ in heads[position + 1:] if later_depth <= level), len(lines))
        out.append((title, '\n'.join(lines[index + 1:end]).strip('\n')))
    return out


def heading(level, ident, title=None):
    text = ident if not title or title == ident else f'{ident}: {title}'
    return '#' * level + ' ' + re.sub(r'\s+', ' ', text).strip()


def split_heading(title):
    """(id, title) of a card heading `id: title`; the title is '' without one."""
    ident, _, rest = title.partition(': ')
    return ident.strip(), rest.strip()


_FIELD = re.compile(r'^- \*\*([^*:]+):\*\*[ ]?(.*)$')
_NESTED = re.compile(r'^\s{2,}[-*]\s+(.*)$')


def code(value):
    return f'`{value}`' if value != '' else value


def uncode(text):
    value = text.strip()
    return value[1:-1] if len(value) >= 2 and value.startswith('`') and value.endswith('`') else value


def field_lines(fields, coded=()):
    """Field bullets: a scalar on the line, a list as nested bullets. Keys in `coded` are written in backticks."""
    lines = []
    for key, value in fields.items():
        wrap = code if key in coded else (lambda item: item)
        if isinstance(value, (list, tuple)):
            lines.append(f'- **{key}:**')
            lines.extend(f'  - {wrap(clean_text(str(item), 500))}' for item in value)
        elif value is None or value == '':
            lines.append(f'- **{key}:**')
        else:
            lines.append(f'- **{key}:** {wrap(clean_text(str(value), 1000))}')
    return '\n'.join(lines) + ('\n' if lines else '')


def parse_card(body, level):
    """(prose, fields, subsections) of a card body: the text before the first field, the field
    bullets (a scalar string or a list of strings), and the `level + 1` subsections by title."""
    subs = dict(sections(body, level + 1))
    head = re.split(r'^#{1,6}\s', body, maxsplit=1, flags=re.M)[0]
    prose, fields, key = [], {}, None
    for line in head.split('\n'):
        match = _FIELD.match(line)
        if match:
            key = match.group(1).strip()
            fields[key] = uncode(match.group(2)) if match.group(2).strip() else ''
            continue
        nested = _NESTED.match(line)
        if nested and key is not None:
            current = fields[key]
            fields[key] = [*(current if isinstance(current, list) else ([current] if current else [])), uncode(nested.group(1))]
            continue
        if line.strip() == '':
            continue
        if key is None:
            prose.append(line.strip())
        else:
            key = None
            prose.append(line.strip())
    return ' '.join(prose), fields, subs


def bullets_in(text):
    """The top-level bullet items of the text, backticks removed from around each."""
    items = []
    for line in text.split('\n'):
        match = re.match(r'^[-*]\s+(.*)$', line)
        if match:
            items.append(uncode(match.group(1)))
    return items


def bullet_list(items, coded=True):
    """Bullets of the items, in backticks by default (paths and ids)."""
    return ''.join(f'- {code(str(item)) if coded else item}\n' for item in items)
