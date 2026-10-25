#!/usr/bin/env python3
"""Check the topology an extraction script wrote and render it as Markdown (ADR-0033, ADR-0042).

    python3 render_topology.py <app> --topology FILE --out DIR

--topology is the topology.json the model-written extraction script wrote (scratch, never committed):
the tree system -> domain -> leaf, the edges between leaves, the entry points, the dead ends, the
observations and the flows. It is checked against the schema first (a failure names what is wrong and
fails the step). --out is the folder topology.md is written to (10-applications/<app>/01-legacy/): the
modules and the edges between them, the largest leaves and the edges between those, the entry points,
the observations and the flows, with a diagram. It also writes three Mermaid diagrams beside it, call-graph.mmd,
data-lineage.mmd and critical-path.mmd (the busiest leaves, the data stores with who touches them, the longest
chain from an entry point), each only when the topology has something to draw. Per-leaf and per-edge detail beyond the caps below stays
in the run; the catalog (render_catalog.py) keeps the links between items. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402
import paths  # noqa: E402
import topology_units as tu  # noqa: E402

MAX_LEAVES_LISTED = 1000
MAX_DATASTORES_LISTED = 200
MAX_EDGES_LISTED = 2000
MAX_DIAGRAM_EDGES = 40
MAX_LIST = 200
MAX_GRAPH_NODES = 40
MAX_GRAPH_EDGES = 90
MAX_LINEAGE_STORES = 25
MAX_PATH_DEPTH = 14
REQUIRED = ('system', 'root', 'edges', 'entryPoints', 'deadEnds', 'observations', 'flows')


def is_string_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


OBSERVATION_TEXT_KEYS = ('observation', 'text', 'description', 'summary', 'finding', 'note', 'title', 'message')


def observation_text(item):
    """An observation as a string: the model-written script often emits objects ({"text": ...}) or numbers instead of plain strings."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in OBSERVATION_TEXT_KEYS:
            if isinstance(item.get(key), str) and item[key].strip():
                return item[key]
        parts = [value for value in item.values() if isinstance(value, str) and value.strip()]
        return ': '.join(parts) if parts else None
    if isinstance(item, (int, float)) and not isinstance(item, bool):
        return str(item)
    return None


def normalize(topology):
    """Coerce "observations" to a list of strings when each item carries a text (a lone string becomes a one-item list)."""
    if not isinstance(topology, dict):
        return
    observations = topology.get('observations')
    if isinstance(observations, str):
        observations = [observations]
    if isinstance(observations, list):
        texts = [observation_text(item) for item in observations]
        if all(text is not None for text in texts):
            topology['observations'] = texts


def valid_node(node, depth=0):
    if depth > 100 or not isinstance(node, dict):
        return False
    if not all(isinstance(node.get(key), str) and node[key] for key in ('id', 'name', 'kind')):
        return False
    children = node.get('children', [])
    return isinstance(children, list) and all(valid_node(child, depth + 1) for child in children)


def check(topology):
    """DataError naming the first thing wrong with the extraction script's topology."""
    if not isinstance(topology, dict):
        raise docmd.DataError('topology.json must be an object')
    missing = [key for key in REQUIRED if key not in topology]
    if missing:
        raise docmd.DataError(f'topology.json lacks the key(s) {", ".join(missing)}: every top-level key must be present (observations and flows may be empty lists)')
    if not isinstance(topology['system'], str) or not topology['system']:
        raise docmd.DataError('topology.json: "system" must be a non-empty string')
    if not valid_node(topology['root']):
        raise docmd.DataError('topology.json: every node of "root" needs a string id, name and kind, and "children" must be a list')
    if not isinstance(topology['edges'], list) or any(
        not isinstance(edge, dict) or not all(isinstance(edge.get(key), str) and edge[key] for key in ('source', 'target', 'kind')) for edge in topology['edges']
    ):
        raise docmd.DataError('topology.json: every edge needs a string source, target and kind')
    for key in ('entryPoints', 'deadEnds', 'observations'):
        if not is_string_list(topology[key]):
            raise docmd.DataError(f'topology.json: "{key}" must be a list of strings (not objects or numbers), for example ["<one sentence>"]')
    if not isinstance(topology['flows'], list):
        raise docmd.DataError('topology.json: "flows" must be a list')
    for flow in topology['flows']:
        if not isinstance(flow, dict) or not isinstance(flow.get('name'), str) or not isinstance(flow.get('steps'), list):
            raise docmd.DataError('topology.json: every flow needs a name and a list of steps')
        if any(not isinstance(step, dict) or not isinstance(step.get('label'), str) or not is_string_list(step.get('nodes')) for step in flow['steps']):
            raise docmd.DataError('topology.json: every flow step needs a label and a list of node ids')


def render(topology, app):
    leaves = tu.walk_topology(topology)
    by_id = {leaf['id']: leaf for leaf in leaves}
    entry = {value for value in topology['entryPoints'] if value in by_id}
    dead = {value for value in topology['deadEnds'] if value in by_id}
    edges = [edge for edge in topology['edges'] if edge['source'] in by_id and edge['target'] in by_id]

    domains = {}
    for leaf in leaves:
        name = leaf['domain'] or 'Other'
        entry_info = domains.setdefault(name, {'leaves': 0, 'stores': 0, 'loc': 0})
        if leaf['kind'] == 'datastore':
            entry_info['stores'] += 1
        else:
            entry_info['leaves'] += 1
            entry_info['loc'] += leaf['loc'] or 0
    names = sorted(domains)
    code = [leaf for leaf in leaves if leaf['kind'] != 'datastore']
    stores = [leaf for leaf in leaves if leaf['kind'] == 'datastore']

    between = {}
    for edge in edges:
        source, target = by_id[edge['source']]['domain'] or 'Other', by_id[edge['target']]['domain'] or 'Other'
        if source == target:
            continue
        cell = between.setdefault((source, target), {'kinds': set(), 'edges': 0})
        cell['kinds'].add(edge['kind'])
        cell['edges'] += 1

    listed = sorted(code, key=lambda leaf: (-(leaf['loc'] or 0), leaf['id']))[:MAX_LEAVES_LISTED] + sorted(stores, key=lambda leaf: leaf['id'])[:MAX_DATASTORES_LISTED]
    shown = {leaf['id'] for leaf in listed}
    shown_edges = sorted((edge for edge in edges if edge['source'] in shown and edge['target'] in shown), key=lambda edge: (edge['source'], edge['target'], edge['kind']))[:MAX_EDGES_LISTED]
    truncated = len(listed) < len(leaves) or len(shown_edges) < len(edges)

    front = docmd.front_matter({
        'app': app,
        'system': topology['system'],
        'domains': len(names),
        'leaves': len(code),
        'dataStores': len(stores),
        'edges': len(edges),
        'entryPoints': len(entry),
        'deadEnds': len(dead),
        'flows': len(topology['flows']),
        'truncated': truncated,
    })
    out = [
        front,
        f'# Topology of {topology["system"]}',
        '',
        f'{len(code):,} leaves in {len(names)} domain(s), {len(stores)} data store(s), {len(edges):,} edge(s). '
        + ('The largest leaves and the edges between them are listed; the links between catalog items are in the catalog.' if truncated else 'Every leaf and edge is listed.'),
        '',
        '## Domains',
        '',
        docmd.table(['Domain', 'Leaves', 'Data stores', 'LOC'], [[name, domains[name]['leaves'], domains[name]['stores'], domains[name]['loc']] for name in names]),
        '## Edges between domains',
        '',
        docmd.table(['From', 'To', 'Kinds', 'Edges'], [[source, target, ', '.join(sorted(cell['kinds'])), cell['edges']] for (source, target), cell in sorted(between.items())]),
        '## Leaves',
        '',
        docmd.table(['Leaf', 'Name', 'Kind', 'Domain', 'File', 'LOC', 'Entry point', 'Dead end'], [
            [leaf['id'], leaf['name'], leaf['kind'], leaf['domain'] or 'Other', leaf['file'] or '', '' if leaf['loc'] is None else leaf['loc'], 'yes' if leaf['id'] in entry else '', 'yes' if leaf['id'] in dead else '']
            for leaf in listed
        ]),
        '## Edges',
        '',
        docmd.table(['Source', 'Target', 'Kind'], [[edge['source'], edge['target'], edge['kind']] for edge in shown_edges]),
    ]
    if topology['observations']:
        out += ['## Observations', '', docmd.bullet_list([docmd.clean_text(line, 400) for line in topology['observations'][:MAX_LIST]], coded=False)]
    if topology['flows']:
        out += ['## Flows', '']
        for flow in topology['flows'][:MAX_LIST]:
            out += [docmd.heading(3, docmd.clean_text(flow['name'], 120)), '', docmd.field_lines({'persona': docmd.clean_text(flow.get('persona'), 120), 'description': docmd.clean_text(flow.get('description'), 400)}),
                    docmd.table(['Step', 'Nodes'], [[docmd.clean_text(step['label'], 200), ', '.join(step['nodes'][:20])] for step in flow['steps'][:50]])]
    ranked = sorted(between.items(), key=lambda pair: (-pair[1]['edges'], pair[0]))[:MAX_DIAGRAM_EDGES]
    if ranked:
        ident = {name: f'd{index}' for index, name in enumerate(names)}
        lines = ['flowchart LR']
        lines += [f'  {ident[name]}["{docmd.clean_text(name, 40).replace(chr(34), chr(39))}<br/>{domains[name]["leaves"]} leaves"]' for name in names]
        lines += [f'  {ident[source]} -->|{cell["edges"]}| {ident[target]}' for (source, target), cell in ranked]
        out += ['## Diagram', '', 'The strongest links between domains (edge labels count the leaf-level edges).', '', '```mermaid', *lines, '```', '']
    return '\n'.join(out).rstrip() + '\n'


def node_label(leaf):
    return docmd.clean_text(leaf['name'] or leaf['id'], 40).replace(chr(34), chr(39))


def call_graph(leaves, edges):
    """The busiest code leaves (most edges) and the edges between them, as a left-to-right flowchart; None when there is none."""
    code = {leaf['id']: leaf for leaf in leaves if leaf['kind'] != 'datastore'}
    degree = {}
    for edge in edges:
        if edge['source'] in code and edge['target'] in code and edge['source'] != edge['target']:
            degree[edge['source']] = degree.get(edge['source'], 0) + 1
            degree[edge['target']] = degree.get(edge['target'], 0) + 1
    chosen = sorted(degree, key=lambda leaf_id: (-degree[leaf_id], leaf_id))[:MAX_GRAPH_NODES]
    if not chosen:
        return None
    ident = {leaf_id: f'n{index}' for index, leaf_id in enumerate(sorted(chosen))}
    shown = sorted({(edge['source'], edge['target'], edge['kind']) for edge in edges if edge['source'] in ident and edge['target'] in ident and edge['source'] != edge['target']})[:MAX_GRAPH_EDGES]
    lines = ['flowchart LR']
    lines += [f'  {ident[leaf_id]}["{node_label(code[leaf_id])}"]' for leaf_id in sorted(ident)]
    lines += [f'  {ident[source]} -->|{docmd.clean_text(kind, 20).replace("|", "/")}| {ident[target]}' for source, target, kind in shown]
    return '\n'.join(lines) + '\n'


def data_lineage(leaves, edges):
    """The data stores touched most and the leaves that touch them; None when no leaf touches a store."""
    by_id = {leaf['id']: leaf for leaf in leaves}
    touches = {}
    for edge in edges:
        for store_id, other_id in ((edge['target'], edge['source']), (edge['source'], edge['target'])):
            if by_id[store_id]['kind'] == 'datastore' and by_id[other_id]['kind'] != 'datastore':
                touches.setdefault(store_id, set()).add((other_id, edge['kind'], store_id == edge['target']))
    stores = sorted(touches, key=lambda store_id: (-len(touches[store_id]), store_id))[:MAX_LINEAGE_STORES]
    if not stores:
        return None
    ident = {}
    for store_id in sorted(stores):
        ident[store_id] = f'd{len(ident)}'
    lines = ['flowchart LR']
    for store_id in sorted(stores):
        lines.append(f'  {ident[store_id]}[("{node_label(by_id[store_id])}")]')
    edge_lines = []
    for store_id in sorted(stores):
        for other_id, kind, writes in sorted(touches[store_id])[:12]:
            if other_id not in ident:
                ident[other_id] = f'n{len(ident)}'
                lines.append(f'  {ident[other_id]}["{node_label(by_id[other_id])}"]')
            label = docmd.clean_text(kind, 20).replace('|', '/')
            edge_lines.append(f'  {ident[other_id]} -->|{label}| {ident[store_id]}' if writes else f'  {ident[store_id]} -->|{label}| {ident[other_id]}')
    return '\n'.join(lines + edge_lines) + '\n'


def critical_path(leaves, edges, entry):
    """The longest chain of calls from an entry point (a back edge ends a chain), as a top-down flowchart; None when no chain has two steps."""
    by_id = {leaf['id']: leaf for leaf in leaves}
    successors = {}
    for edge in edges:
        if edge['source'] != edge['target'] and by_id[edge['target']]['kind'] != 'datastore':
            successors.setdefault(edge['source'], []).append(edge['target'])
    for targets in successors.values():
        targets.sort()
    memo = {}

    def longest(leaf_id, path):
        if leaf_id in memo:
            return memo[leaf_id]
        best = [leaf_id]
        if len(path) < MAX_PATH_DEPTH:
            for target in successors.get(leaf_id, []):
                if target in path:
                    continue
                candidate = [leaf_id] + longest(target, path | {leaf_id})
                if len(candidate) > len(best):
                    best = candidate
        memo[leaf_id] = best
        return best

    chains = [longest(leaf_id, frozenset()) for leaf_id in sorted(entry)]
    chain = max(chains, key=len, default=[])
    if len(chain) < 2:
        return None
    lines = ['flowchart TD']
    lines += [f'  n{index}["{node_label(by_id[leaf_id])}"]' for index, leaf_id in enumerate(chain)]
    lines += [f'  n{index} --> n{index + 1}' for index in range(len(chain) - 1)]
    return '\n'.join(lines) + '\n'


def diagrams(topology):
    """The Mermaid diagrams of the topology by file name; one that has nothing to draw is left out."""
    leaves = tu.walk_topology(topology)
    by_id = {leaf['id']: leaf for leaf in leaves}
    edges = [edge for edge in topology['edges'] if edge['source'] in by_id and edge['target'] in by_id]
    entry = {value for value in topology['entryPoints'] if value in by_id}
    found = {
        'call-graph.mmd': call_graph(leaves, edges),
        'data-lineage.mmd': data_lineage(leaves, edges),
        'critical-path.mmd': critical_path(leaves, edges, entry),
    }
    return {name: text for name, text in found.items() if text is not None}


def main(argv):
    ap = argparse.ArgumentParser(description='Check the extracted topology and render it as Markdown.')
    ap.add_argument('app')
    ap.add_argument('--topology', required=True)
    ap.add_argument('--out', required=True, help='the folder topology.md is written to')
    args = ap.parse_args(argv[1:])
    try:
        topology = docmd.read_json(args.topology, 'topology.json')
        normalize(topology)
        check(topology)
        text = render(topology, args.app)
        docmd.write_text(os.path.join(os.path.abspath(args.out), os.path.basename(paths.assessment_topology_path(args.app))), text)
        for name, diagram in diagrams(topology).items():
            docmd.write_text(os.path.join(os.path.abspath(args.out), name), diagram)
    except (docmd.DataError, OSError, RecursionError) as error:
        print(f'render_topology.py: {error}', file=sys.stderr)
        return 1
    leaves = tu.walk_topology(topology)
    print(f'{sum(1 for leaf in leaves if leaf["kind"] != "datastore")} leaf(s), {len(topology["edges"])} edge(s), {len(topology["flows"])} flow(s) -> topology.md')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
