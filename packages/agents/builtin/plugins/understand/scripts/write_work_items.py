#!/usr/bin/env python3
"""Write one work-item file per unit of the understand stage's traceability matrix.

    python3 write_work_items.py <app> --traceability FILE --out DIR [--existing DIR] [--repo ID]

--traceability is traceability.json (merge_traceability.py). Each unit becomes
<out>/applications/<app>/units/<module>/<unit>/unit.md, a unit file of the document repository
(frontmatter = state, docs/reference/document-repo-unit-files.md): id, application, module, kind,
title, phase `discover-assess`, stage `understand`, status `pending`, complexity from the unit's
size, dependsOn from the matrix, the legacy source paths, and links to the AS-IS specification and
the business rules. --existing is the document repository's applications/<app>/units/ folder: a
unit that already has a unit.md there is skipped, so a person's progress on it is never
overwritten. Values are written as JSON scalars and lists, which YAML reads unchanged. Standard
library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths  # noqa: E402

MAX_JSON_BYTES = 8_000_000
SEGMENT = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')


class DataError(ValueError):
    """Invalid or unsafe input."""


def complexity(loc):
    if not isinstance(loc, int) or isinstance(loc, bool):
        return None
    return 'low' if loc < 500 else 'medium' if loc < 2000 else 'high'


def frontmatter(app, unit, repo):
    q = lambda value: json.dumps(value, ensure_ascii=False)  # noqa: E731
    lines = [
        '---',
        f'id: {q(unit["id"])}',
        f'application: {q(app)}',
        f'module: {q(unit["module"])}',
        f'kind: {q(unit["kind"] or "module")}',
        f'title: {q(unit["title"])}',
        'phase: discover-assess',
        'stage: understand',
        'status: pending',
    ]
    level = complexity(unit.get('loc'))
    if level:
        lines.append(f'complexity: {level}')
    lines.append(f'dependsOn: {q(unit["dependsOn"])}')
    if unit['files']:
        lines += ['source:', f'  - {{repo: {q(repo)}, paths: {q(unit["files"])}}}']
    links = []
    if unit.get('spec'):
        links.append(f'  asIs: {q(unit["spec"])}')
    if unit['rules']:
        links.append(f'  businessRules: {q(unit["rules"])}')
    if links:
        lines += ['links:'] + links
    lines.append('---')
    return lines


def body(app, unit):
    text = [f'{unit["title"]}: proposed by the understand stage from the map of {app}.']
    if unit.get('spec'):
        text.append(f'AS-IS specification: `{unit["spec"]}`.')
    else:
        text.append('No AS-IS specification was written for this unit in this run.')
    if unit['findings']:
        text.append(f'Security findings: {", ".join(unit["findings"])} ({paths.generated_file_path(app, "SECURITY_FINDINGS.md")}).')
    if unit['entryPoint']:
        text.append('This unit holds an entry point of the application.')
    return ' '.join(text)


def main(argv):
    ap = argparse.ArgumentParser(description='Write one work-item file per unit of traceability.json.')
    ap.add_argument('app')
    ap.add_argument('--traceability', required=True)
    ap.add_argument('--out', required=True, help='the document-repository root the units/ folder is written under')
    ap.add_argument('--existing', help="the document repository's applications/<app>/units/ folder")
    ap.add_argument('--repo', default='legacy', help='the legacy repository id the source paths belong to')
    args = ap.parse_args(argv[1:])
    app = args.app
    written, skipped = 0, []
    try:
        if not SEGMENT.match(app):
            raise DataError('the application id must be kebab-case')
        path = args.traceability
        if not os.path.isfile(path) or os.path.islink(path) or os.path.getsize(path) > MAX_JSON_BYTES:
            raise DataError('traceability.json is missing, a link or too large')
        with open(path, encoding='utf-8-sig') as handle:
            matrix = json.load(handle)
        units = matrix.get('units') if isinstance(matrix, dict) else None
        if not isinstance(units, list) or not units:
            raise DataError('traceability.json lists no units')
        root = os.path.abspath(args.out)
        for unit in units:
            module, name = unit.get('module'), unit.get('unit')
            if not (isinstance(module, str) and SEGMENT.match(module) and isinstance(name, str) and SEGMENT.match(name)):
                raise DataError(f'unit {unit.get("id")!r} has an unsafe module or unit name')
            if unit.get('id') != f'{app}/{module}/{name}':
                raise DataError(f'unit {unit.get("id")!r} does not match its module and name')
            if args.existing and os.path.exists(os.path.join(args.existing, module, name, 'unit.md')):
                skipped.append(unit['id'])
                continue
            target = os.path.join(root, *paths.unit_state_path(app, module, name).split('/'))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if os.path.islink(target):
                raise DataError(f'refusing to write through a symbolic link: {target}')
            with open(target, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write('\n'.join(frontmatter(app, unit, args.repo)) + '\n\n' + body(app, unit) + '\n')
            written += 1
    except (DataError, OSError, ValueError, KeyError, TypeError) as error:
        print(f'write_work_items.py: {error}', file=sys.stderr)
        return 1
    print(f'{written} work item(s) written under {paths.units_dir(app)}/, {len(skipped)} already present and left unchanged')
    for unit in skipped[:50]:
        print(f'- kept: {unit}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
