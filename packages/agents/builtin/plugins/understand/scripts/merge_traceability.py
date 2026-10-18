#!/usr/bin/env python3
"""Merge the understand stage's per-unit traceability fragments into one deterministic matrix.

    python3 merge_traceability.py <app> --units FILE --trace DIR --specs DIR --out DIR
        [--assessment DIR] [--source DIR] [--source-repo ID] [--source-commit SHA]

--units is units.json (units_from_topology.py); --trace the folder of the fragments the
specification jobs returned (<module>/<unit>.json, one per unit); --specs the folder holding the
specifications (<module>/<unit>.md) that land at applications/<app>/units/<module>/<unit>/as-is.md;
--assessment the folder holding the application's BUSINESS_RULES.md and SECURITY_FINDINGS.md
(applications/<app>/generated/) when they name the valid RULE and SEC ids; --source
the read-only source checkout (a cited file that does not exist there is left out).
Writes traceability.json and traceability.md to --out (the application's generated/ folder).

What the map says (units, files, dependencies between units, data-store access, candidate rules and
findings by file) is the base; a fragment adds what its job confirmed in the code. Every value is
checked: unit references must name a unit, rule and finding ids must have the RULE-NNN / SEC-NNN shape
and exist in their catalog when it is present, paths must be relative. What fails a check is left out
and counted in `notes`. The output is sorted, so the same inputs always give the same files.
Standard library only.
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
MAX_TEXT_BYTES = 5_000_000
MAX_LIST = 200
# RULE-NNN estate ids, the legacy RULE-<module>.<unit>-NN item ids and the citation-derived
# RULE-<module>.<unit>-<hash> ones (ADR-0038); the same shapes for SEC.
RULE_SRC = r'RULE-(?:\d{2,}|[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62})?-(?:\d{2,}|[0-9a-f]{8}(?:-[a-z0-9][a-z0-9-]{0,31})?))'
RULE_ID = re.compile(rf'^{RULE_SRC}$')
FINDING_ID = re.compile(r'^SEC-(\d{3}|[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}-\d{2,})$')
RULE_HEADING = re.compile(rf'^### ({RULE_SRC}): ')
FINDING_ANY = re.compile(r'\bSEC-(?:\d{3}|[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}-\d{2,})\b')


class DataError(ValueError):
    """Invalid or unsafe input."""


def read_bytes(path, limit):
    if os.path.islink(path):
        raise DataError(f'refusing to read through a symbolic link: {os.path.basename(path)}')
    if os.path.getsize(path) > limit:
        raise DataError(f'{os.path.basename(path)} exceeds the {limit}-byte limit')
    with open(path, 'rb') as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise DataError(f'{os.path.basename(path)} exceeds the {limit}-byte limit')
    return data


def read_json(path):
    try:
        return json.loads(read_bytes(path, MAX_JSON_BYTES).decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataError(f'{os.path.basename(path)} is not valid UTF-8 JSON') from error


def one_line(value, limit=120):
    text = ' '.join(str(value).split())
    return text[:limit]


def norm_path(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        return None
    path = value.split(':', 1)[0].strip().replace('\\', '/')
    path = os.path.normpath(path).replace('\\', '/')
    if path in ('.', '..') or path.startswith(('/', '../')) or re.match(r'^[A-Za-z]:', path):
        return None
    return path


def strings(value):
    return [entry for entry in value if isinstance(entry, str) and entry.strip()][:MAX_LIST] if isinstance(value, list) else []


def known_rules(assessment):
    path = os.path.join(assessment, 'BUSINESS_RULES.md') if assessment else ''
    if not path or not os.path.isfile(path):
        return None
    text = read_bytes(path, MAX_TEXT_BYTES).decode('utf-8-sig', errors='replace')
    return {match.group(1) for line in text.splitlines() if (match := RULE_HEADING.match(line))}


def known_findings(assessment):
    path = os.path.join(assessment, 'SECURITY_FINDINGS.md') if assessment else ''
    if not path or not os.path.isfile(path):
        return None
    text = read_bytes(path, MAX_TEXT_BYTES).decode('utf-8-sig', errors='replace')
    return set(FINDING_ANY.findall(text))


def cycles(units):
    """Strongly connected components of more than one unit (Tarjan, iterative), sorted."""
    graph = {unit['id']: unit['dependsOn'] for unit in units}
    index, low, on_stack, stack, found, counter = {}, {}, set(), [], [], [0]
    for start in sorted(graph):
        if start in index:
            continue
        work = [(start, iter(graph[start]))]
        index[start] = low[start] = counter[0]
        counter[0] += 1
        stack.append(start)
        on_stack.add(start)
        while work:
            node, children = work[-1]
            advanced = False
            for child in children:
                if child not in graph:
                    continue
                if child not in index:
                    index[child] = low[child] = counter[0]
                    counter[0] += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(graph[child])))
                    advanced = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                component = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member == node:
                        break
                if len(component) > 1:
                    found.append(sorted(component))
    return sorted(found)


def merge(app, units_doc, trace_dir, specs_dir, assessment, source=None):
    units = [unit for unit in units_doc.get('units', []) if isinstance(unit, dict) and isinstance(unit.get('key'), str)]
    if not units:
        raise DataError('units.json lists no units')
    rules_known = known_rules(assessment)
    findings_known = known_findings(assessment)
    stores = {store['id']: store for store in units_doc.get('dataStores', []) if isinstance(store, dict) and isinstance(store.get('id'), str)}
    store_names = {store.get('name'): sid for sid, store in stores.items() if isinstance(store.get('name'), str)}
    by_ref = {}
    for unit in units:
        by_ref[unit['id']] = unit['id']
        by_ref[unit['key']] = unit['id']
    notes = {'invalid rule ids': 0, 'unknown rule ids': 0, 'invalid finding ids': 0, 'unknown finding ids': 0,
             'unresolved dependencies': 0, 'invalid paths': 0, 'files not in the source': 0, 'missing fragments': 0, 'invalid fragments': 0}
    merged = {}
    for unit in units:
        entry = {
            'id': unit['id'],
            'module': unit.get('module'),
            'unit': unit.get('unit'),
            'title': one_line(unit.get('title', unit['key'])),
            'kind': unit.get('kind'),
            'loc': unit.get('loc'),
            'entryPoint': bool(unit.get('entryPoint')),
            'spec': None,
            'files': set(path for path in map(norm_path, strings(unit.get('files'))) if path),
            'dependsOn': set(dep for dep in strings(unit.get('dependsOn')) if dep in by_ref),
            'dataStores': {store['id']: set(store.get('access', [])) for store in unit.get('dataStores', []) if isinstance(store, dict) and store.get('id') in stores},
            'externalSystems': set(),
            'rules': set(strings(unit.get('rules'))),
            'findings': set(strings(unit.get('findings'))),
            'dataObjects': set(),
            'entryPoints': set(),
            'requirements': set(),
            'pullRequests': set(),
            'tests': set(),
            'openQuestions': 0,
        }
        spec = os.path.join(specs_dir, *unit['key'].split('/')) + '.md'
        if os.path.isfile(spec) and not os.path.islink(spec):
            entry['spec'] = paths.knowledge_as_is_unit_path(app, unit['key'])
        fragment_path = os.path.join(trace_dir, *unit['key'].split('/')) + '.json'
        fragment = None
        if os.path.isfile(fragment_path):
            try:
                fragment = read_json(fragment_path)
            except DataError:
                fragment = None
            if not isinstance(fragment, dict):
                notes['invalid fragments'] += 1
                fragment = None
        elif entry['spec'] is not None:
            notes['missing fragments'] += 1
        if fragment is not None:
            entry['rules'].update(strings(fragment.get('rulesApplied')))
            entry['findings'].update(strings(fragment.get('findings')))
            for path in strings(fragment.get('files')):
                clean = norm_path(path)
                if not clean:
                    notes['invalid paths'] += 1
                elif source and not os.path.exists(os.path.join(source, *clean.split('/'))):
                    notes['files not in the source'] += 1
                else:
                    entry['files'].add(clean)
            entry['dataObjects'].update(one_line(value, 80) for value in strings(fragment.get('dataObjects')))
            entry['externalSystems'].update(one_line(value, 80) for value in strings(fragment.get('externalSystems')))
            entry['entryPoints'].update(one_line(value, 160) for value in strings(fragment.get('entryPoints')))
            entry['requirements'].update(strings(fragment.get('requirements')))
            entry['pullRequests'].update(strings(fragment.get('pullRequests')))
            entry['tests'].update(strings(fragment.get('tests')))
            questions = fragment.get('openQuestions')
            entry['openQuestions'] = questions if isinstance(questions, int) and not isinstance(questions, bool) and questions >= 0 else 0
            for dep in fragment.get('dependencies', []) if isinstance(fragment.get('dependencies'), list) else []:
                if not isinstance(dep, dict) or not isinstance(dep.get('target'), str):
                    notes['unresolved dependencies'] += 1
                    continue
                target, kind = dep['target'].strip(), dep.get('kind')
                inbound = dep.get('direction') == 'inbound'
                if target in by_ref and by_ref[target] != unit['id']:
                    entry.setdefault('inbound' if inbound else 'outbound', set()).add(by_ref[target])
                elif kind in ('read', 'write') and (target in stores or target in store_names):
                    entry['dataStores'].setdefault(target if target in stores else store_names[target], set()).add(kind)
                elif kind == 'integration':
                    entry['externalSystems'].add(one_line(target, 80))
                else:
                    notes['unresolved dependencies'] += 1
        merged[unit['id']] = entry
    for entry in merged.values():
        entry['dependsOn'].update(entry.pop('outbound', set()))
        for other in entry.pop('inbound', set()):
            merged[other]['dependsOn'].add(entry['id'])
    for entry in merged.values():
        entry['dependsOn'].discard(entry['id'])
        valid_rules = set()
        for rule in entry['rules']:
            if not RULE_ID.match(rule):
                notes['invalid rule ids'] += 1
            elif rules_known is not None and rule not in rules_known:
                notes['unknown rule ids'] += 1
            else:
                valid_rules.add(rule)
        entry['rules'] = valid_rules
        valid_findings = set()
        for finding in entry['findings']:
            if not FINDING_ID.match(finding):
                notes['invalid finding ids'] += 1
            elif findings_known is not None and finding not in findings_known:
                notes['unknown finding ids'] += 1
            else:
                valid_findings.add(finding)
        entry['findings'] = valid_findings
    used_by = {uid: set() for uid in merged}
    for entry in merged.values():
        for dep in entry['dependsOn']:
            used_by[dep].add(entry['id'])
    result_units = []
    for uid in sorted(merged):
        entry = merged[uid]
        result_units.append({
            'id': uid,
            'module': entry['module'],
            'unit': entry['unit'],
            'title': entry['title'],
            'kind': entry['kind'],
            'loc': entry['loc'],
            'entryPoint': entry['entryPoint'],
            'spec': entry['spec'],
            'files': sorted(entry['files']),
            'dependsOn': sorted(entry['dependsOn']),
            'usedBy': sorted(used_by[uid]),
            'dataStores': [{'id': sid, 'access': sorted(access)} for sid, access in sorted(entry['dataStores'].items())],
            'externalSystems': sorted(entry['externalSystems']),
            'rules': sorted(entry['rules']),
            'findings': sorted(entry['findings']),
            'dataObjects': sorted(entry['dataObjects']),
            'entryPoints': sorted(entry['entryPoints']),
            'requirements': sorted(entry['requirements']),
            'pullRequests': sorted(entry['pullRequests']),
            'tests': sorted(entry['tests']),
            'openQuestions': entry['openQuestions'],
        })

    def index(field):
        table = {}
        for unit in result_units:
            for value in unit[field]:
                table.setdefault(value, []).append(unit['id'])
        return {key: sorted(value) for key, value in sorted(table.items())}

    rules = index('rules')
    findings = index('findings')
    return {
        'app': app,
        'generatedBy': 'merge_traceability.py',
        'inputs': {'businessRules': rules_known is not None, 'securityFindings': findings_known is not None},
        'units': result_units,
        'rules': rules,
        'findings': findings,
        'files': index('files'),
        'requirements': index('requirements'),
        'pullRequests': index('pullRequests'),
        'tests': index('tests'),
        'dataStores': {sid: sorted(u['id'] for u in result_units if any(s['id'] == sid for s in u['dataStores'])) for sid in sorted(stores)},
        'unmappedRules': sorted((rules_known or set()) - set(rules)),
        'unmappedFindings': sorted((findings_known or set()) - set(findings)),
        'cycles': cycles(result_units),
        'notes': {key: value for key, value in notes.items() if value},
    }


def cell(value):
    return one_line(value, 200).replace('|', '\\|')


def ids(values, limit=12):
    values = list(values)
    shown = ', '.join(values[:limit])
    return shown + (f' (+{len(values) - limit})' if len(values) > limit else '') if values else '—'


def render(matrix, repo, commit):
    app = matrix['app']
    units = matrix['units']
    specified = sum(1 for unit in units if unit['spec'])
    short = lambda uid: uid[len(app) + 1:] if uid.startswith(app + '/') else uid  # noqa: E731
    out = [f'Legacy repository {repo} at {commit}', '', f'# Traceability — {app}', '',
           'Generated by `merge_traceability.py` from the unit specifications and the map; do not edit by hand.', '',
           '## Summary', '',
           f'- Units: {len(units)} ({specified} with a specification)',
           f'- Business rules mapped to units: {len(matrix["rules"])}' + ('' if matrix['inputs']['businessRules'] else ' (no BUSINESS_RULES.md: run extract-rules)'),
           f'- Security findings mapped to units: {len(matrix["findings"])}' + ('' if matrix['inputs']['securityFindings'] else ' (no SECURITY_FINDINGS.md: run harden)'),
           f'- Rules no unit applies: {ids(matrix["unmappedRules"])}',
           f'- Findings no unit carries: {ids(matrix["unmappedFindings"])}',
           f'- Dependency cycles: {len(matrix["cycles"])}', '',
           '## Units', '',
           '| Unit | Kind | Specification | Files | Depends on | Data stores | Rules | Findings |',
           '|---|---|---|---|---|---|---|---|']
    for unit in units:
        spec = f'[{short(unit["id"])}]({os.path.relpath(unit["spec"], paths.generated_dir(app)).replace(os.sep, "/")})' if unit['spec'] else 'not written'
        stores = ids(f'{s["id"]} ({"/".join(s["access"])})' for s in unit['dataStores'])
        out.append(f'| {cell(short(unit["id"]))} | {cell(unit["kind"])} | {spec} | {len(unit["files"])} | {cell(ids(map(short, unit["dependsOn"])))} | '
                   f'{cell(stores)} | {cell(ids(unit["rules"]))} | {cell(ids(unit["findings"]))} |')
    for title, field in (('Business rules → units', 'rules'), ('Security findings → units', 'findings'), ('Files → units', 'files')):
        out += ['', f'## {title}', '']
        if not matrix[field]:
            out.append('—')
            continue
        out += ['| Id | Units |', '|---|---|']
        out += [f'| {cell(key)} | {cell(ids(map(short, value)))} |' for key, value in matrix[field].items()]
    if matrix['cycles']:
        out += ['', '## Dependency cycles', '']
        out += [f'- {cell(" ↔ ".join(map(short, cycle)))}' for cycle in matrix['cycles']]
    if matrix['notes']:
        out += ['', '## Left out', '']
        out += [f'- {key}: {value}' for key, value in matrix['notes'].items()]
    return '\n'.join(out) + '\n'


def write(path, text):
    if os.path.islink(path):
        raise DataError(f'refusing to write through a symbolic link: {path}')
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)


def main(argv):
    ap = argparse.ArgumentParser(description='Merge per-unit traceability fragments into one matrix.')
    ap.add_argument('app')
    ap.add_argument('--units', required=True)
    ap.add_argument('--trace', required=True)
    ap.add_argument('--specs', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--assessment')
    ap.add_argument('--source', help='the read-only source checkout: cited files that do not exist there are left out')
    ap.add_argument('--source-repo', default='(unknown repository)')
    ap.add_argument('--source-commit', default='(unknown commit)')
    args = ap.parse_args(argv[1:])
    try:
        if not os.path.isfile(args.units):
            raise DataError('units.json is missing')
        units_doc = read_json(args.units)
        if not isinstance(units_doc, dict):
            raise DataError('units.json must contain an object')
        matrix = merge(args.app, units_doc, args.trace, args.specs, args.assessment, args.source)
        os.makedirs(args.out, exist_ok=True)
        write(os.path.join(args.out, 'traceability.json'), json.dumps(matrix, indent=1, ensure_ascii=False) + '\n')
        write(os.path.join(args.out, 'traceability.md'), render(matrix, one_line(args.source_repo, 200), one_line(args.source_commit, 64)))
    except (DataError, OSError, RecursionError) as error:
        print(f'merge_traceability.py: {error}', file=sys.stderr)
        return 1
    units = matrix['units']
    print(f'{len(units)} units, {sum(1 for u in units if u["spec"])} specified, {len(matrix["rules"])} rules and {len(matrix["findings"])} findings mapped, '
          f'{len(matrix["cycles"])} cycle(s)')
    for key, value in matrix['notes'].items():
        print(f'left out: {key}: {value}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
