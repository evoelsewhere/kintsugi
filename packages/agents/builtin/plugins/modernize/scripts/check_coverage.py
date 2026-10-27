#!/usr/bin/env python3
"""Report which requirements no design of a set refers to.

    python3 check_coverage.py <app> --set SET [--root DIR] [--report FILE] [--json]

Run from the root of the stage's inputs (or name it with --root). The requirements are the `REQ-` sections of
`10-applications/<app>/02-modern/requirements.md`. A requirement is *covered* when a design document of the set, in any
unit's folder or in the application's own (`_design/<set>/`), names its id. The documents read are the ones under --root: the
merged designs and, in a portal run, the ones the run wrote, so the report covers the whole application and not only the
units of the run (a requirement a later unit will take is reported as uncovered until then).

This is information for the pull request, never a fault: the exit code is 0 whatever the report says (2 for input that
cannot be used). --report writes `{"set", "total", "covered", "requirements": [{"id", "units", "covered"}], "uncovered": [...]}`.
Standard library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import design_lib as dl  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
SET_ID = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
REQUIREMENT = re.compile(r'\bREQ-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*')
MAX_UNITS = 2000


def _children(folder):
    if not os.path.isdir(folder) or os.path.islink(folder):
        return []
    return sorted(name for name in os.listdir(folder) if not os.path.islink(os.path.join(folder, name)) and os.path.isdir(os.path.join(folder, name)))


def _documents(folder):
    found = []
    for directory, names, files in os.walk(folder):
        names[:] = sorted(name for name in names if not os.path.islink(os.path.join(directory, name)))
        found.extend(os.path.join(directory, file) for file in sorted(files) if file.endswith('.md') and not os.path.islink(os.path.join(directory, file)))
    return found


def design_folders(root, app, set_id):
    """[(unit key, folder)] of the designs of the set on disk; the application's own is `@app`."""
    modern = os.path.join(root, *paths.modern_dir(app).split('/'))
    out = []
    own = os.path.join(root, *paths.application_design_set_dir(app, set_id).split('/'))
    if os.path.isdir(own):
        out.append((dl.APPLICATION_KEY, own))
    for module in _children(modern):
        if not paths.is_unit_segment(module):
            continue
        for unit in _children(os.path.join(modern, module)):
            if paths.is_unit_segment(unit) and len(out) < MAX_UNITS:
                folder = os.path.join(modern, module, unit, set_id)
                if os.path.isdir(folder) and not os.path.islink(folder):
                    out.append((f'{module}/{unit}', folder))
    return out


def coverage(root, app, set_id):
    ids = dl.requirement_ids(root, app)
    seen = {ident: [] for ident in ids}
    for key, folder in design_folders(root, app, set_id):
        text = '\n'.join(docmd.read_text(path) for path in _documents(folder))
        for ident in set(REQUIREMENT.findall(text)):
            if ident in seen and key not in seen[ident]:
                seen[ident].append(key)
    rows = [{'id': ident, 'units': sorted(seen[ident]), 'covered': bool(seen[ident])} for ident in ids]
    return {'set': set_id, 'total': len(rows), 'covered': sum(1 for row in rows if row['covered']), 'requirements': rows, 'uncovered': [row['id'] for row in rows if not row['covered']]}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Report which requirements no design of a set refers to.')
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('--set', dest='set_id', required=True, metavar='SET', help='the design set')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--report', metavar='FILE', help='also write the JSON report to this file')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    args = parser.parse_args(argv)
    if not APP.match(args.app) or not SET_ID.match(args.set_id):
        print('check_coverage.py: the application and the set must be kebab-case ids', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('check_coverage.py: --root must be an existing directory', file=sys.stderr)
        return 2
    try:
        report = coverage(root, args.app, args.set_id)
        if args.report is not None:
            docmd.write_text(os.path.abspath(args.report), json.dumps(report, indent=1, ensure_ascii=False))
    except (docmd.DataError, OSError) as error:
        print(f'check_coverage.py: {error}', file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, indent=1, ensure_ascii=False))
    else:
        print(f'{report["covered"]} of {report["total"]} requirement(s) are referred to by a design of "{args.set_id}"')
        for ident in report['uncovered']:
            print(f'  not covered: {ident}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
