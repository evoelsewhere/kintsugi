#!/usr/bin/env python3
"""Mark the run's generated design documents deterministically, after the agent and fix round."""
import argparse
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402
import paths  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True)
    parser.add_argument('--set', required=True)
    parser.add_argument('--units', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args(argv)
    manifest = docmd.read_json(args.manifest)
    for key in args.units.split(','):
        unit = manifest.get('units', {}).get(key, {})
        prefix = paths.application_design_set_dir(args.app, args.set) if key == '@app' else paths.unit_design_set_dir(args.app, *paths.split_unit_key(key), args.set)
        for file in unit.get('files', []):
            if not file.get('written'):
                continue
            relative = file['path']
            if not isinstance(relative, str) or not relative.startswith(prefix + '/') or not relative.endswith('.md'):
                raise docmd.DataError('draft marker can only write documents of the selected design set')
            source = os.path.join(args.root, *relative.split('/'))
            if not isinstance(relative, str) or relative.startswith('/') or any(part in ('', '.', '..') for part in relative.split('/')) or not docmd.within(args.root, source):
                raise docmd.DataError('invalid design path in manifest')
            if not os.path.isfile(source) or os.path.islink(source):
                continue
            text = docmd.read_text(source)
            match = re.match(r'^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)', text)
            if match:
                fields = re.sub(r'^draft\s*:.*(?:\n|$)', '', match[1], flags=re.M)
                text = '---\n' + fields.rstrip() + '\ndraft: true\n---\n' + text[match.end():]
            else:
                text = '---\ndraft: true\n---\n' + text
            # Keep the unresolved input reasons in scratch/the PR description, not an answer file.
            target = os.path.join(args.out, *relative.split('/'))
            if not docmd.within(args.out, target):
                raise docmd.DataError('design output path leaves its output directory')
            docmd.write_text(target, text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
