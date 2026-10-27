#!/usr/bin/env python3
"""Order the units of a design run by what they call, and group the ones that share interfaces.

    python3 map_design.py <app> <module/unit | @app>[,...] --set SET [--root DIR] --out FILE

Run from the root of the stage's inputs (or name it with --root). The links between the units are those of the committed
catalog (`10-applications/<app>/01-legacy/_catalog/<module>.md`, the `Depends on` and `Used by` of each item card). From
them this writes a JSON map (scratch of the run, never published):

  waves     the selected units in the order they are designed: a unit whose callee is also selected comes after it, so its
            designer can read the callee's design; units that call each other (a cycle) share a wave
  clusters  the selected units that are linked to each other, and the neighbours outside the selection that already have a
            design of the set (the `peers`, read-only); a cluster is only listed when there is something to keep consistent
            (two units, or a unit with a designed peer): the contract reviewer reads one cluster per job

A set of scope `application` is designed once for the application itself (`@app`): one wave, no cluster. The map is built
from documents only; nothing is guessed from code. Exit 0, or 2 for input that cannot be used. Standard library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import docmd  # noqa: E402
import paths  # noqa: E402

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
SET_ID = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
ITEM_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
APPLICATION_KEY = '@app'
MAX_PEER_DOCUMENTS = 40


def catalog_links(root, app, modules):
    """({item: [items it depends on]}, {item: [items that use it]}) from the cards of the modules; retired items are left out."""
    depends, used_by = {}, {}
    for module in sorted(modules):
        path = os.path.join(root, *paths.assessment_catalog_module_path(app, module).split('/'))
        if not os.path.isfile(path) or os.path.islink(path):
            continue
        body = docmd.split_front_matter(docmd.read_text(path))[1]
        for title, card in docmd.sections(body, 2):
            item_id, _ = docmd.split_heading(title)
            if not ITEM_ID.match(item_id):
                continue
            _, fields, subs = docmd.parse_card(card, 2)
            if fields.get('status') == 'retired':
                continue
            depends[item_id] = sorted({row['item'] for row in docmd.records_in(subs.get('Depends on', '')) if ITEM_ID.match(row.get('item', '')) and row['item'] != item_id})
            used_by[item_id] = sorted({value for value in docmd.bullets_in(subs.get('Used by', '')) if ITEM_ID.match(value) and value != item_id})
    return depends, used_by


def components(nodes, edges):
    """Strongly connected components: ({node: index}, [sorted member lists]). Recursive: a run has at most a few dozen units."""
    index, low, stack, on_stack, owner, groups = {}, {}, [], set(), {}, []

    def visit(node):
        index[node] = low[node] = len(index)
        stack.append(node)
        on_stack.add(node)
        for target in sorted(edges.get(node, ())):
            if target not in index:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in on_stack:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            members = []
            while True:
                member = stack.pop()
                on_stack.discard(member)
                members.append(member)
                owner[member] = len(groups)
                if member == node:
                    break
            groups.append(sorted(members))

    for node in nodes:
        if node not in index:
            visit(node)
    return owner, groups


def linked_groups(nodes, edges):
    """Connected groups of nodes, ignoring the direction of the edges."""
    neighbours = {node: set() for node in nodes}
    for source, targets in edges.items():
        for target in targets:
            neighbours[source].add(target)
            neighbours[target].add(source)
    seen, groups = set(), []
    for node in nodes:
        if node in seen:
            continue
        group, todo = [], [node]
        seen.add(node)
        while todo:
            current = todo.pop()
            group.append(current)
            for other in sorted(neighbours[current]):
                if other not in seen:
                    seen.add(other)
                    todo.append(other)
        groups.append(sorted(group))
    return groups


def designed_documents(root, app, key, set_id):
    """The documents of the set the unit already has, as document-repository paths (the unit's design of the set is on disk)."""
    module, unit = paths.split_unit_key(key)
    base = paths.unit_design_set_dir(app, module, unit, set_id)
    folder = os.path.join(root, *base.split('/'))
    if not os.path.isdir(folder) or os.path.islink(folder):
        return []
    found = []
    for directory, names, files in os.walk(folder):
        names[:] = sorted(name for name in names if not os.path.islink(os.path.join(directory, name)))
        for file in sorted(files):
            full = os.path.join(directory, file)
            if file.endswith('.md') and not os.path.islink(full):
                found.append(os.path.relpath(full, root).replace(os.sep, '/'))
    return found[:MAX_PEER_DOCUMENTS]


def build(root, app, keys, set_id):
    if keys == [APPLICATION_KEY]:
        return {'app': app, 'set': set_id, 'units': {APPLICATION_KEY: {'wave': 0, 'cluster': None, 'dependsOn': [], 'calls': [], 'usedBy': [], 'cycle': None}},
                'waves': [[APPLICATION_KEY]], 'clusters': []}
    if APPLICATION_KEY in keys:
        raise docmd.DataError('the application is designed on its own: do not mix @app with units')
    selected = set(keys)
    depends, used_by = catalog_links(root, app, {key.split('/')[0] for key in keys})
    inside = {key: sorted(set(depends.get(key, ())) & selected) for key in keys}
    owner, groups = components(keys, {key: set(targets) for key, targets in inside.items()})
    depth = {}

    def depth_of(component):
        if component in depth:
            return depth[component]
        depth[component] = 0
        below = [owner[target] for member in groups[component] for target in inside[member] if owner[target] != component]
        depth[component] = 1 + max((depth_of(other) for other in below), default=-1)
        return depth[component]

    wave_of = {key: depth_of(owner[key]) for key in keys}
    waves = [sorted(key for key in keys if wave_of[key] == number) for number in range(max(wave_of.values()) + 1)]
    clusters, cluster_of = [], {}
    for group in linked_groups(keys, inside):
        outside = sorted({other for key in group for other in [*depends.get(key, ()), *used_by.get(key, ())] if other not in selected})
        peers = [{'unit': other, 'documents': documents} for other in outside for documents in [designed_documents(root, app, other, set_id)] if documents]
        if len(group) < 2 and not peers:
            continue
        name = f'c{len(clusters) + 1}'
        clusters.append({'id': name, 'units': group, 'peers': peers})
        for key in group:
            cluster_of[key] = name
    units = {}
    for key in keys:
        units[key] = {
            'wave': wave_of[key],
            'cluster': cluster_of.get(key),
            'dependsOn': inside[key],
            'calls': sorted(set(depends.get(key, ()))),
            'usedBy': sorted(set(used_by.get(key, ()))),
            'cycle': groups[owner[key]] if len(groups[owner[key]]) > 1 else None,
        }
    return {'app': app, 'set': set_id, 'units': units, 'waves': waves, 'clusters': clusters}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Order the units of a design run by what they call, and group the ones that share interfaces.')
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the units of the run, as <module>/<unit> (or @app), comma-separated')
    parser.add_argument('--set', dest='set_id', required=True, metavar='SET', help='the design set of the run')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--out', required=True, metavar='FILE', help='the JSON map to write')
    args = parser.parse_args(argv)
    if not APP.match(args.app) or not SET_ID.match(args.set_id):
        print('map_design.py: the application and the set must be kebab-case ids', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('map_design.py: --root must be an existing directory', file=sys.stderr)
        return 2
    keys = sorted({key.strip() for key in args.unit.split(',') if key.strip()})
    if not keys or any(key != APPLICATION_KEY and not ITEM_ID.match(key) for key in keys):
        print('map_design.py: name units as <module>/<unit>, or @app', file=sys.stderr)
        return 2
    try:
        docmd.write_text(os.path.abspath(args.out), json.dumps(build(root, args.app, keys, args.set_id), indent=1, ensure_ascii=False))
    except (docmd.DataError, OSError) as error:
        print(f'map_design.py: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
