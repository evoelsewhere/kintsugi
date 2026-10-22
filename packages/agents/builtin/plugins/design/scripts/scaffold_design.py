#!/usr/bin/env python3
"""Create the first draft of a unit's design documents from the project's template (ADR-0045).

    python3 scaffold_design.py <app> <module/unit | @app>[,...] <set> [--file PATH | --all] [--root DIR] [--out DIR] [--manifest FILE]

Run from the root of the document repository checkout (or name it with --root). For each document the set lists for the
unit's kind (the required ones, all of them with --all, or the one named by --file), this writes
`10-applications/<app>/02-modern/<module>/<unit>/<set>/<path>` from the document's template: the front matter names the
template and its version, the variables ({{unit.id}}, {{unit.title}}, {{app.id}}, {{kind}}, {{set.id}}, {{set.version}})
are filled in, a section that lists the unit's rules is seeded from its `rules.md` (in `01-legacy/<module>/<unit>/`), and every section the
author must write holds a TODO until they do. A file that already exists is never overwritten.

Several units can be named at once (comma-separated): a unit that cannot be used is reported and skipped, the others are written.
A design set of scope `application` (ADR-0050) is written for the application itself, named `@app` where a unit goes, under
`10-applications/<app>/02-modern/_design/<set>/`; a set of scope `unit` is never written for `@app`.
With --out the files go there instead of --root (which is then only read: a portal run reads its inputs and writes its
outputs elsewhere); an existing file is looked for in both. --manifest writes a JSON summary: the set, and per unit its kind,
title, the documents it holds (path, template, required, whether this run wrote it) and the reason a unit was skipped.

Exit 0 when the files were written or already existed (a list: at least one unit could be used), 2 for input that cannot be used.
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
import check_design  # noqa: E402
import design_lib as dl  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')


def scaffold(root, app, unit_key, set_id, only_file=None, include_optional=False, out=None, info=None):
    """([created paths], [notes]) for one unit and one set; raises DataError on unusable input.

    `out` is where the files are written (default: `root`); `info`, when given, is filled with the unit's kind and title and
    the documents of the set (for the manifest).
    """
    out = root if out is None else out
    for_application = unit_key == dl.APPLICATION_KEY
    unit = dl.read_application(root, app) if for_application else dl.read_unit(root, app, unit_key)
    sets, problems = check_design.load(root)
    loaded = next((candidate for candidate in sets if candidate['set']['id'] == set_id), None)
    if loaded is None:
        raise docmd.DataError(f'there is no design set "{set_id}" in {paths.design_sets_dir()}/')
    mine = [problem for problem in problems if problem['path'].startswith(f'{paths.design_set_dir(set_id)}/')]
    if mine:
        raise docmd.DataError('fix the design templates first:\n' + '\n'.join(f'  {problem["path"]}: {problem["message"]}' for problem in mine))
    set_ = loaded['set']
    if for_application and set_['scope'] != 'application':
        raise docmd.DataError(f'the design set "{set_id}" is for units, not for the application')
    if not for_application and set_['scope'] == 'application':
        raise docmd.DataError(f'the design set "{set_id}" is for the application: name {dl.APPLICATION_KEY} instead of a unit')
    files = dl.files_for(set_, unit['kind'])
    subject = 'the application' if for_application else f'a unit of kind "{unit["kind"]}"'
    if not files:
        raise docmd.DataError(f'the design set "{set_id}" does not apply to {subject}')
    if only_file is not None:
        files = [file for file in files if file['path'] == only_file]
        if not files:
            raise docmd.DataError(f'the design set "{set_id}" has no file "{only_file}" for {subject}')
    elif not include_optional:
        files = [file for file in files if file['required']]
    rules = [] if for_application else dl.rules_of(root, app, unit_key)
    created, notes = [], []
    if info is not None:
        info.update({'kind': unit['kind'], 'title': unit['title'], 'scope': set_['scope'], 'reads': set_['reads'], 'files': []})
    for need in set_['needs']:
        needed = next((candidate for candidate in sets if candidate['set']['id'] == need), None)
        needed_kind = None if needed is not None and needed['set']['scope'] == 'application' else unit['kind']
        for file in (dl.files_for(needed['set'], needed_kind) if needed else []):
            relative = dl.design_file_path(app, unit_key, needed, file['path'])
            if file['required'] and (need, file['path']) not in unit['waived'] and not os.path.isfile(os.path.join(root, *relative.split('/'))):
                notes.append(f'the set "{need}", which "{set_id}" needs, has no {relative} yet')
    for file in files:
        relative = dl.design_file_path(app, unit_key, loaded, file['path'])
        path = os.path.join(out, *relative.split('/'))
        existing = os.path.join(root, *relative.split('/'))
        if os.path.lexists(path) or os.path.lexists(existing):
            notes.append(f'{relative} exists and was left as it is')
            if info is not None:
                info['files'].append({'path': relative, 'template': file['template'], 'required': file['required'], 'written': False})
            continue
        template = loaded['templates'][file['template']]
        text = dl.scaffold_text(docmd.read_text(os.path.join(root, *paths.design_template_path(set_id, file['template']).split('/'))),
                                template['sections'], set_, None if for_application else f'{app}/{unit_key}', unit['title'], app, unit['kind'], rules)
        docmd.write_text(path, text)
        created.append(relative)
        if info is not None:
            info['files'].append({'path': relative, 'template': file['template'], 'required': file['required'], 'written': True})
    return created, notes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create the first draft of a unit's design documents from the project's template.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit>; several, comma-separated')
    parser.add_argument('set', help='the design set to write')
    parser.add_argument('--file', dest='only_file', metavar='PATH', help='write one document of the set only (an optional one included)')
    parser.add_argument('--all', dest='include_optional', action='store_true', help='write the optional documents of the set too')
    parser.add_argument('--root', default='.', metavar='DIR', help='the document repository checkout (default: the working directory)')
    parser.add_argument('--out', metavar='DIR', help='write the documents here instead of under --root (which is then only read)')
    parser.add_argument('--manifest', metavar='FILE', help='write a JSON summary of what was done')
    args = parser.parse_args(argv)
    if not APP.match(args.app):
        print('scaffold_design.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('scaffold_design.py: --root must be an existing directory', file=sys.stderr)
        return 2
    out = os.path.realpath(args.out) if args.out is not None else root
    keys = [key.strip() for key in args.unit.split(',') if key.strip()]
    if not keys:
        print('scaffold_design.py: name at least one unit', file=sys.stderr)
        return 2
    manifest = {'set': args.set, 'units': {}}
    failures = 0
    for key in keys:
        info = {}
        try:
            created, notes = scaffold(root, args.app, key, args.set, args.only_file, args.include_optional, out, info)
        except (docmd.DataError, OSError) as error:
            print(f'scaffold_design.py: {key}: {error}', file=sys.stderr)
            manifest['units'][key] = {'error': str(error)}
            failures += 1
            continue
        manifest['units'][key] = {**info, 'notes': notes}
        for path in created:
            print(f'created {path}')
        for note in notes:
            print(f'note: {note}')
    if args.manifest is not None:
        docmd.write_text(os.path.abspath(args.manifest), json.dumps(manifest, indent=1, ensure_ascii=False))
    return 2 if failures == len(keys) else 0


if __name__ == '__main__':
    sys.exit(main())
