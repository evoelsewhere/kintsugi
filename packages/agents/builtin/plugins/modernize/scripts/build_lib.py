"""What the scripts that review a member's merge request share (ADR-0071): units and rules, the review notes and a
bounded read of the reports of a run.

Not a script on its own. Standard library only; nothing here follows text from the code it reads.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import design_lib as dl  # noqa: E402
import docmd  # noqa: E402

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
UNIT_KEY = dl.UNIT_KEY
REPOSITORY_ID = re.compile(r'^[a-z0-9][a-z0-9._-]{0,127}$', re.IGNORECASE)
COMMIT = re.compile(r'^[0-9a-f]{40}([0-9a-f]{24})?$')
SEVERITIES = ('blocker', 'major', 'minor')
REVIEW_CATEGORIES = ('fidelity', 'tests', 'failure', 'design', 'security')
REVIEW_COLUMNS = ['severity', 'file', 'where', 'category', 'finding', 'suggestion']


def keys_of(value):
    return [key.strip() for key in value.split(',') if key.strip()]


def real_file(path):
    return os.path.isfile(path) and not os.path.islink(path)


def real_dir(path):
    return os.path.isdir(path) and not os.path.islink(path)


def doc_path(root, relative):
    return os.path.join(root, *relative.split('/'))


def unit_rules(root, app, unit_key):
    """[(id, title)] of the unit's rules, from its understanding."""
    return dl.rules_of(root, app, unit_key)


def design_files(root, app, unit_key):
    """The design documents of a unit that are merged: every Markdown file in each of its set folders (a `_` folder is not a set)."""
    import paths
    base = doc_path(root, paths.unit_key_modern_path(app, unit_key, '').rstrip('/'))
    found = []
    if not real_dir(base):
        return found
    for name in sorted(os.listdir(base)):
        folder = os.path.join(base, name)
        if name.startswith('_') or not real_dir(folder):
            continue
        for current, directories, files in os.walk(folder):
            directories[:] = sorted(d for d in directories if not d.startswith('_') and not os.path.islink(os.path.join(current, d)))
            for file in sorted(files):
                full = os.path.join(current, file)
                if file.endswith('.md') and real_file(full):
                    found.append(os.path.relpath(full, root).replace(os.sep, '/'))
    return found


def table_document(text, columns, what):
    """(front matter, records) of a document whose first table has exactly `columns`; raises DataError otherwise."""
    data, body = docmd.split_front_matter(text)
    tables = docmd.tables_in(body)
    if not tables or [cell.strip().lower() for cell in tables[0][0]] != columns:
        raise docmd.DataError(f'{what} has no table with the columns ' + ' | '.join(name.capitalize() for name in columns))
    return data, docmd.records_in(body)


def plain(value):
    """A table cell without its code quotes."""
    return docmd.uncode(value.strip()) if value else ''


def read_report(path):
    """A scratch report, or None when it is not there or not valid."""
    if not path or not real_file(path):
        return None
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return None
    return data if isinstance(data, dict) else None


def by_unit(report):
    """{unit key (without the application) → entry} of a report whose `units` are named `<app>/<module>/<unit>`."""
    out = {}
    for entry in (report or {}).get('units', []):
        if isinstance(entry, dict) and isinstance(entry.get('unit'), str):
            out[entry['unit'].split('/', 1)[1] if entry['unit'].count('/') >= 2 else entry['unit']] = entry
    return out
