#!/usr/bin/env python3
"""Check the project's design sets themselves (ADR-0045).

    python3 validate_design_templates.py [--root DIR] [--json]

Run from the root of the document repository checkout (or name it with --root), for example on the pull request that
changes `01-standards/templates/`. Every set is checked: a unique id that matches its folder, a title, an integer version, the
files table, template files that exist, known directives and checks with valid parameters, the profile of each unit kind
(`<set>/<kind>/profile.md`, ADR-0053: its kind and version, the files it adds or removes, the templates it uses), kinds the project
declares in `kintsugi.yaml`, and `needs` that name existing sets without a cycle.

Exit 0 when the sets are valid (or there are none), 1 when something is wrong, 2 for input that cannot be used.
Standard library only.
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_design  # noqa: E402
import docmd  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check the project's design sets themselves.")
    parser.add_argument('--root', default='.', metavar='DIR', help='the document repository checkout (default: the working directory)')
    parser.add_argument('--json', action='store_true', help='print the result as JSON')
    args = parser.parse_args(argv)
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('validate_design_templates.py: --root must be an existing directory', file=sys.stderr)
        return 2
    try:
        sets, problems = check_design.load(root)
    except (docmd.DataError, OSError) as error:
        print(f'validate_design_templates.py: {error}', file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({'sets': [{'id': loaded['set']['id'], 'version': loaded['set']['version']} for loaded in sets], 'problems': problems}, indent=1, ensure_ascii=False))
    else:
        for problem in problems:
            print(f'{problem["path"]}: {problem["message"]}')
        print(f'{len(sets)} design set(s), {len(problems)} problem(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
