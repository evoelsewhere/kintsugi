#!/usr/bin/env python3
"""Prepare the review of a member's merge request: find, for each unit it builds, what the reviewer needs, and write the manifest (ADR-0071).

    python3 prepare_review.py <app> <module/unit>[,...] --target REPO --mr-url URL --mr-commit SHA [--mr-branch NAME]
                              [--root DIR] --manifest FILE

Run from the root of the stage's inputs (or name it with --root). A unit can be reviewed when its card, its rules and at least
one merged design document exist: the reviewer judges the code against them. The manifest (`scratch/<app>/build/manifest.json`)
holds, per unit, the rules and the design documents, or an `error` that says why the unit cannot be reviewed (it is left out of
the run; the others go on), and the merge request: its URL, the commit the reviewer reads and the branch. The exit code is 0
whatever the units are, and 2 for input that cannot be used. Standard library only.
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_lib as bl  # noqa: E402
import docmd  # noqa: E402

dl = bl.dl


def prepare_unit(root, app, key):
    entry = {'unit': key, 'error': None, 'kind': None, 'title': key, 'rules': [], 'design': []}
    try:
        info = dl.read_unit(root, app, key)
    except (docmd.DataError, OSError) as error:
        entry['error'] = str(error)
        return entry
    entry['kind'], entry['title'] = info['kind'], info['title']
    entry['rules'] = [{'id': ident, 'name': name} for ident, name in bl.unit_rules(root, app, key)]
    if not entry['rules']:
        entry['error'] = 'the unit has no rules: understand it first'
        return entry
    entry['design'] = bl.design_files(root, app, key)
    if not entry['design']:
        entry['error'] = 'the unit has no merged design: generate and merge its design first'
    return entry


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare the review of a member's merge request.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the units the merge request builds, as <module>/<unit>, comma-separated')
    parser.add_argument('--target', required=True, metavar='REPO', help='the id of the target repository the merge request is on')
    parser.add_argument('--mr-url', required=True, metavar='URL', help='the merge request, as the member recorded it')
    parser.add_argument('--mr-commit', required=True, metavar='SHA', help='the head commit of the merge request the reviewer reads')
    parser.add_argument('--mr-branch', default='', metavar='NAME')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--manifest', required=True, metavar='FILE', help='the manifest to write')
    args = parser.parse_args(argv)
    if not bl.APP.match(args.app):
        print('prepare_review.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    if not bl.REPOSITORY_ID.match(args.target) or not bl.COMMIT.match(args.mr_commit):
        print('prepare_review.py: --target must be a repository id and --mr-commit a commit id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('prepare_review.py: --root must be an existing directory', file=sys.stderr)
        return 2
    keys = bl.keys_of(args.unit)
    if not keys or any(not bl.UNIT_KEY.match(key) for key in keys):
        print('prepare_review.py: name units as <module>/<unit>', file=sys.stderr)
        return 2
    units = {key: prepare_unit(root, args.app, key) for key in keys}
    manifest = {
        'app': args.app,
        'target': args.target,
        'mr': {'url': docmd.clean_text(args.mr_url, 500), 'commit': args.mr_commit, 'branch': docmd.clean_text(args.mr_branch, 200)},
        'units': units,
    }
    docmd.write_text(os.path.abspath(args.manifest), json.dumps(manifest, indent=1, ensure_ascii=False))
    for key, entry in units.items():
        print(f'{args.app}/{key}: ' + (f'cannot be reviewed: {entry["error"]}' if entry['error'] else f'{len(entry["rules"])} rule(s), {len(entry["design"])} design document(s)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
