#!/usr/bin/env python3
"""Create the first draft of a unit's design documents from the project's template (ADR-0045).

    python3 scaffold_design.py <app> <module/unit | @app>[,...] <set> [--file PATH | --all] [--regenerate] [--root DIR] [--out DIR] [--manifest FILE]

Run from the root of the document repository checkout (or name it with --root). For each document the set lists for the
unit's kind (the required ones, all of them with --all, or the one named by --file), this writes
`10-applications/<app>/02-modern/<module>/<unit>/<set>/<path>` from the document's template (the one in the unit kind's profile folder when it has one of that name, else the set's): the front matter names the
template and its version, the variables ({{unit.id}}, {{unit.title}}, {{app.id}}, {{kind}}, {{set.id}}, {{set.version}})
are filled in (`{{set.version}}` is the version of the template in use), a section that lists the unit's rules is seeded from its `rules.md` (in `01-legacy/<module>/<unit>/`), and every section the
author must write holds a TODO until they do. A file that already exists is never overwritten, unless --regenerate says the
design is to be written again (ADR-0081): then a document that exists under --root is replaced by a fresh skeleton in --out (or in
place when --out is --root), the optional documents the unit already has are written again with the required ones, and a file already
under --out, written by this run, is still left alone so that a retried run keeps what it finished.

Several units can be named at once (comma-separated): a unit that cannot be used is reported and skipped, the others are written.
A design set of scope `application` (ADR-0050) is written for the application itself, named `@app` where a unit goes, under
`10-applications/<app>/02-modern/_design/<set>/`; a set of scope `unit` is never written for `@app`.
With --out the files go there instead of --root (which is then only read: a portal run reads its inputs and writes its
outputs elsewhere); an existing file is looked for in both. --manifest writes a JSON summary: the set, and per unit its kind,
title, the profile of its kind (ADR-0053), the documents it holds (path, template, the template file and the reference it names, the example
for the designer, required, whether this run wrote it) and the reason a unit was skipped.

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
import design_preflight as preflight

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')


def _manifest_entry(set_id, relative, file):
    """One document in the manifest: its path, the template it is written with (a path in the repository), the reference it names and its example."""
    return {'path': relative, 'template': file['template'], 'required': file['required'], 'templateFile': paths.design_template_path(set_id, file['templateFile']),
            'ref': dl.ref_text(file['ref']), 'example': paths.design_template_path(set_id, file['example']) if file['example'] else None}


def scaffold(root, app, unit_key, set_id, only_file=None, include_optional=False, out=None, info=None, regenerate=False, require_ready=False, draft=False):
    """([created paths], [notes]) for one unit and one set; raises DataError on unusable input.

    `out` is where the files are written (default: `root`); `info`, when given, is filled with the unit's kind and title and
    the documents of the set (for the manifest). `regenerate` writes the skeletons again over a design the unit already has.
    """
    out = root if out is None else out
    for_application = unit_key == dl.APPLICATION_KEY
    unit = dl.read_application(root, app) if for_application else dl.read_unit(root, app, unit_key)
    blockers = [] if for_application else preflight.unit_blockers(root, app, unit_key)
    if require_ready and not for_application and preflight.catalog_item(root, app, unit_key) is None:
        raise docmd.DataError('the unit is not active in the merged catalog; assess and merge its scope first')
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
    files = dl.files_for(loaded, unit['kind'])
    subject = 'the application' if for_application else f'a unit of kind "{unit["kind"]}"'
    if not files:
        raise docmd.DataError(f'the design set "{set_id}" does not apply to {subject}')
    if only_file is not None:
        files = [file for file in files if file['path'] == only_file]
        if not files:
            raise docmd.DataError(f'the design set "{set_id}" has no file "{only_file}" for {subject}')
    elif not include_optional:
        # A regeneration also writes again the optional documents the unit already has.
        files = [file for file in files if file['required'] or (regenerate and os.path.lexists(os.path.join(root, *dl.design_file_path(app, unit_key, loaded, file['path']).split('/'))))]
    blockers.extend(preflight.dependency_blockers(root, app, unit_key, loaded, sets, unit))
    if require_ready and blockers and not draft:
        raise docmd.DataError('not ready for a final design: ' + '; '.join(blockers) + '; resolve and merge these inputs, or explicitly generate a draft')
    rules = [] if for_application else dl.rules_of(root, app, unit_key)
    created, notes = [], []
    if info is not None:
        profile = unit['kind'] in loaded['profiles'] if unit['kind'] is not None else False
        info.update({'kind': unit['kind'], 'title': unit['title'], 'scope': set_['scope'], 'reads': set_['reads'],
                     'draft': draft, 'blockers': blockers, 'profile': paths.design_profile_path(set_id, unit['kind']) if profile else None, 'files': []})
    for need in set_['needs']:
        needed = next((candidate for candidate in sets if candidate['set']['id'] == need), None)
        needed_kind = None if needed is not None and needed['set']['scope'] == 'application' else unit['kind']
        for file in (dl.files_for(needed, needed_kind) if needed else []):
            relative = dl.design_file_path(app, unit_key, needed, file['path'])
            if file['required'] and (need, file['path']) not in unit['waived'] and not os.path.isfile(os.path.join(root, *relative.split('/'))):
                notes.append(f'the set "{need}", which "{set_id}" needs, has no {relative} yet')
    for file in files:
        relative = dl.design_file_path(app, unit_key, loaded, file['path'])
        path = os.path.join(out, *relative.split('/'))
        existing = os.path.join(root, *relative.split('/'))
        previous = None
        if regenerate and os.path.isfile(existing) and not os.path.islink(existing):
            previous = paths.design_previous_path(app, unit_key, set_id, file['path'])
            saved = os.path.join(out, *previous.split('/'))
            if not os.path.exists(saved):
                docmd.write_text(saved, docmd.read_text(existing))
        previous_info = {'previous': previous} if previous else {}
        in_place = os.path.realpath(out) == os.path.realpath(root)
        # Regenerating replaces what is under --root; what this run already wrote under --out is kept.
        keep = os.path.lexists(path) if regenerate and not in_place else (os.path.lexists(path) or os.path.lexists(existing)) and not regenerate
        if keep:
            notes.append(f'{relative} exists and was left as it is')
            if info is not None:
                info['files'].append({**_manifest_entry(set_id, relative, file), **previous_info, 'written': False})
            continue
        template = dl.template_of(loaded, file)
        text = dl.scaffold_text(docmd.read_text(os.path.join(root, *paths.design_template_path(set_id, file['templateFile']).split('/'))),
                                template['sections'], set_id, file['ref'], None if for_application else f'{app}/{unit_key}', unit['title'], app, unit['kind'], rules)
        docmd.write_text(path, text)
        created.append(relative)
        if regenerate and os.path.lexists(existing) and not in_place:
            notes.append(f'{relative} is written again over the existing design')
        if info is not None:
            info['files'].append({**_manifest_entry(set_id, relative, file), **previous_info, 'written': True})
    return created, notes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create the first draft of a unit's design documents from the project's template.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit>; several, comma-separated')
    parser.add_argument('set', help='the design set to write')
    parser.add_argument('--file', dest='only_file', metavar='PATH', help='write one document of the set only (an optional one included)')
    parser.add_argument('--all', dest='include_optional', action='store_true', help='write the optional documents of the set too')
    parser.add_argument('--require-ready', action='store_true', help='check merged input evidence and dependencies before generating a final design')
    parser.add_argument('--draft', action='store_true', help='explicitly allow incomplete input evidence for a non-final design')
    parser.add_argument('--regenerate', action='store_true', help='write the skeletons again over a design the unit already has (ADR-0081)')
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
            created, notes = scaffold(root, args.app, key, args.set, args.only_file, args.include_optional, out, info, args.regenerate, args.require_ready, args.draft)
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
    return 2 if failures == len(keys) or (args.require_ready and failures > 0) else 0


if __name__ == '__main__':
    sys.exit(main())
