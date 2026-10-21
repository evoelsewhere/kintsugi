#!/usr/bin/env python3
"""Create the first draft of a unit's design documents from the project's template (ADR-0045).

    python3 scaffold_design.py <app> <module/unit> <set> [--file PATH | --all] [--root DIR]

Run from the root of the document repository checkout (or name it with --root). For each document the set lists for the
unit's kind (the required ones, all of them with --all, or the one named by --file), this writes
`applications/<app>/units/<module>/<unit>/design/<set>/<path>` from the document's template: the front matter names the
template and its version, the variables ({{unit.id}}, {{unit.title}}, {{app.id}}, {{kind}}, {{set.id}}, {{set.version}})
are filled in, a section that lists the unit's rules is seeded from its `understanding/rules.md`, and every section the
author must write holds a TODO until they do. A file that already exists is never overwritten.

Exit 0 when the files were written or already existed, 2 for input that cannot be used. Standard library only.
"""
import argparse
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


def scaffold(root, app, unit_key, set_id, only_file=None, include_optional=False):
    """([created paths], [notes]) for one unit and one set; raises DataError on unusable input."""
    unit = dl.read_unit(root, app, unit_key)
    sets, problems = check_design.load(root)
    loaded = next((candidate for candidate in sets if candidate['set']['id'] == set_id), None)
    if loaded is None:
        raise docmd.DataError(f'there is no design set "{set_id}" in {paths.design_sets_dir()}/')
    mine = [problem for problem in problems if problem['path'].startswith(f'{paths.design_set_dir(set_id)}/')]
    if mine:
        raise docmd.DataError('fix the design templates first:\n' + '\n'.join(f'  {problem["path"]}: {problem["message"]}' for problem in mine))
    set_ = loaded['set']
    files = dl.files_for(set_, unit['kind'])
    if not files:
        raise docmd.DataError(f'the design set "{set_id}" does not apply to a unit of kind "{unit["kind"]}"')
    if only_file is not None:
        files = [file for file in files if file['path'] == only_file]
        if not files:
            raise docmd.DataError(f'the design set "{set_id}" has no file "{only_file}" for a unit of kind "{unit["kind"]}"')
    elif not include_optional:
        files = [file for file in files if file['required']]
    module, unit_name = paths.split_unit_key(unit_key)
    rules = dl.rules_of(root, app, unit_key)
    created, notes = [], []
    for need in set_['needs']:
        needed = next((candidate for candidate in sets if candidate['set']['id'] == need), None)
        for file in (dl.files_for(needed['set'], unit['kind']) if needed else []):
            relative = paths.unit_design_file_path(app, module, unit_name, need, file['path'])
            if file['required'] and (need, file['path']) not in unit['waived'] and not os.path.isfile(os.path.join(root, *relative.split('/'))):
                notes.append(f'the set "{need}", which "{set_id}" needs, has no {relative} yet')
    for file in files:
        relative = paths.unit_design_file_path(app, module, unit_name, set_id, file['path'])
        path = os.path.join(root, *relative.split('/'))
        if os.path.lexists(path):
            notes.append(f'{relative} exists and was left as it is')
            continue
        template = loaded['templates'][file['template']]
        text = dl.scaffold_text(docmd.read_text(os.path.join(root, *paths.design_template_path(set_id, file['template']).split('/'))),
                                template['sections'], set_, f'{app}/{unit_key}', unit['title'], app, unit['kind'], rules)
        docmd.write_text(path, text)
        created.append(relative)
    return created, notes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create the first draft of a unit's design documents from the project's template.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit>')
    parser.add_argument('set', help='the design set to write')
    parser.add_argument('--file', dest='only_file', metavar='PATH', help='write one document of the set only (an optional one included)')
    parser.add_argument('--all', dest='include_optional', action='store_true', help='write the optional documents of the set too')
    parser.add_argument('--root', default='.', metavar='DIR', help='the document repository checkout (default: the working directory)')
    args = parser.parse_args(argv)
    if not APP.match(args.app):
        print('scaffold_design.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('scaffold_design.py: --root must be an existing directory', file=sys.stderr)
        return 2
    try:
        created, notes = scaffold(root, args.app, args.unit, args.set, args.only_file, args.include_optional)
    except (docmd.DataError, OSError) as error:
        print(f'scaffold_design.py: {error}', file=sys.stderr)
        return 2
    for path in created:
        print(f'created {path}')
    for note in notes:
        print(f'note: {note}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
