#!/usr/bin/env python3
"""Check a unit's design documents against the project's design sets (ADR-0045).

    python3 check_design.py <app> <module/unit> [--set SET] [--root DIR] [--json]

Run from the root of the document repository checkout (or name it with --root). For every design set that applies to the
unit's kind (`kind` in its unit.md), each document the set lists is read from
`applications/<app>/units/<module>/<unit>/design/<set>/` and checked against its template: the front matter names the
template, every required section is there and not empty, tables have their columns, and the checks the template names
pass (no TODO left, every rule of the unit covered, references that resolve, ids of the right shape). A file the
unit's `waived` list names, with a reason, is accepted; a design written against an older version of its set is reported as
stale, not as a fault.

The same checks run in the API, so the portal shows what this prints. Exit 0 when every required file is there and
conforms (or is waived), 1 when something is missing or wrong, 2 for input that cannot be used.
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


def load(root):
    """(sets, problems) of the project's design sets; the unit kinds of kintsugi.yaml are checked when it declares them."""
    kinds = docmd.manifest_unit_kinds(os.path.join(root, 'kintsugi.yaml'))
    return dl.load_sets(dl.read_sources(root), kinds or None)


def check_unit(root, app, unit_key, only_set=None):
    """{'unit', 'kind', 'sets': [{'set', 'version', 'files': [...]}], 'ok'} for one unit; raises DataError on unusable input."""
    unit = dl.read_unit(root, app, unit_key)
    sets, problems = load(root)
    chosen = [loaded for loaded in sets if (only_set is None or loaded['set']['id'] == only_set) and dl.files_for(loaded['set'], unit['kind'])]
    if only_set is not None and not any(loaded['set']['id'] == only_set for loaded in sets):
        raise docmd.DataError(f'there is no design set "{only_set}" in {paths.design_sets_dir()}/')
    if only_set is not None and not chosen:
        raise docmd.DataError(f'the design set "{only_set}" does not apply to a unit of kind "{unit["kind"]}"')
    mine = [problem for problem in problems if any(problem['path'].startswith(f'{paths.design_set_dir(loaded["set"]["id"])}/') for loaded in chosen)]
    if mine:
        raise docmd.DataError('fix the design templates first:\n' + '\n'.join(f'  {problem["path"]}: {problem["message"]}' for problem in mine))
    module, unit_name = paths.split_unit_key(unit_key)
    context = dl.unit_context(root, app, unit_key, sets)
    report = {'unit': f'{app}/{unit_key}', 'kind': unit['kind'], 'sets': [], 'ok': True}
    for loaded in chosen:
        set_ = loaded['set']
        files = []
        for file in dl.files_for(set_, unit['kind']):
            waiver = unit['waived'].get((set_['id'], file['path']))
            path = os.path.join(root, *paths.unit_design_file_path(app, module, unit_name, set_['id'], file['path']).split('/'))
            entry = {'path': file['path'], 'required': file['required'], 'state': 'conformant', 'problems': [], 'stale': False, 'waived': waiver}
            if waiver is not None:
                entry['state'] = 'waived'
            elif not os.path.isfile(path) or os.path.islink(path):
                entry['state'] = 'missing'
            else:
                text = docmd.read_text(path)
                entry['problems'] = dl.check_document(loaded['templates'][file['template']], set_, text, context)
                entry['stale'] = dl.is_stale(text, set_)
                entry['state'] = 'problems' if entry['problems'] else 'conformant'
            if entry['state'] == 'problems' or (entry['state'] == 'missing' and file['required']):
                report['ok'] = False
            files.append(entry)
        report['sets'].append({'set': set_['id'], 'version': set_['version'], 'files': files})
    return report


def render(report):
    lines = [f'{report["unit"]} ({report["kind"]})']
    if not report['sets']:
        lines.append('  no design set applies to this kind')
    for entry in report['sets']:
        lines.append(f'  {entry["set"]}@{entry["version"]}')
        for file in entry['files']:
            state = {'conformant': 'conformant', 'waived': f'waived: {file["waived"]}', 'missing': 'missing' if file['required'] else 'not written (optional)',
                     'problems': f'{len(file["problems"])} problem(s)'}[file['state']]
            lines.append(f'    {file["path"]}: {state}' + (' (written against an older version of the set)' if file['stale'] else ''))
            for problem in file['problems']:
                lines.append(f'      - {"[" + problem["section"] + "] " if problem.get("section") else ""}{problem["message"]}')
    lines.append('ok' if report['ok'] else 'not ready: a required file is missing or a document has problems')
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check a unit's design documents against the project's design sets.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit>')
    parser.add_argument('--set', dest='only_set', metavar='SET', help='check one design set only')
    parser.add_argument('--root', default='.', metavar='DIR', help='the document repository checkout (default: the working directory)')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    args = parser.parse_args(argv)
    if not APP.match(args.app):
        print('check_design.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('check_design.py: --root must be an existing directory', file=sys.stderr)
        return 2
    try:
        report = check_unit(root, args.app, args.unit, args.only_set)
    except (docmd.DataError, OSError) as error:
        print(f'check_design.py: {error}', file=sys.stderr)
        return 2
    print(json.dumps(report, indent=1, ensure_ascii=False) if args.json else render(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
