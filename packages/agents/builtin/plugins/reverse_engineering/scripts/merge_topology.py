#!/usr/bin/env python3
"""Merge topology fragments, node descriptions, and flows into the portal map."""

import argparse
import hashlib
import json
import os
import re
import sys

MAX_JSON_BYTES = 2_000_000
MAX_TEXT_BYTES = 500_000
MAX_NODES = 50_000
MAX_FRAGMENTS = 1_000
MAX_OUTPUT_BYTES = 8_000_000
MAX_TOTAL_INPUT_BYTES = 50_000_000
LEAF_KINDS = {'module', 'datastore', 'job', 'screen'}
EDGE_KINDS = {'call', 'dispatch', 'read', 'write'}
NUMBER = re.compile(r'\b\d+(?:[.,]\d+)*\b')
WORD = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*(?:[./:-][A-Za-z_$0-9][A-Za-z0-9_$.-]*)*")
IDENTIFIER = re.compile(r'(?:[A-Za-z_$]*[A-Z][a-z]+[A-Z][A-Za-z0-9_$]*|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*|[A-Z]{2,}[A-Z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*[_$][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*(?:[./:-][A-Za-z_$0-9][A-Za-z0-9_$.-]*)+)')


class DataError(ValueError):
    """Invalid, oversized, or unsafe input data."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


def read_bytes(path, root, label, limit):
    if not within(root, path):
        raise DataError(f'{label} escapes its input root: {path}')
    try:
        if os.path.getsize(path) > limit:
            raise DataError(f'{label} exceeds the {limit}-byte limit')
        with open(path, 'rb') as handle:
            raw = handle.read(limit + 1)
    except OSError as error:
        raise DataError(f'cannot read {label} {path}: {error}') from error
    if len(raw) > limit:
        raise DataError(f'{label} exceeds the {limit}-byte limit')
    return raw


def account_input(budget, size):
    if budget is not None:
        budget[0] += size
        if budget[0] > MAX_TOTAL_INPUT_BYTES:
            raise DataError(f'input files exceed the {MAX_TOTAL_INPUT_BYTES}-byte aggregate limit')


def read_json(path, root, label='JSON input', budget=None):
    raw = read_bytes(path, root, label, MAX_JSON_BYTES)
    account_input(budget, len(raw))
    try:
        return json.loads(raw.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise DataError(f'{label} is not valid UTF-8 JSON: {error}') from error


def validate_node(node, ids, leaves, depth=0):
    if depth > 100 or not isinstance(node, dict):
        raise DataError('topology tree contains an invalid or excessively deep node')
    node_id = node.get('id')
    kind = node.get('kind')
    if not isinstance(node_id, str) or not node_id or node_id in ids:
        raise DataError('topology tree nodes must have unique non-empty string ids')
    if not isinstance(node.get('name'), str) or not isinstance(kind, str):
        raise DataError(f'topology node {node_id!r} needs string name and kind fields')
    ids.add(node_id)
    if kind in LEAF_KINDS:
        leaves.add(node_id)
    elif kind not in ('system', 'domain'):
        raise DataError(f'topology node {node_id!r} has unsupported kind {kind!r}')
    loc = node.get('loc')
    if loc is not None and (not isinstance(loc, int) or isinstance(loc, bool) or loc < 0):
        raise DataError(f'topology node {node_id!r} loc must be a non-negative integer')
    file_path = node.get('file')
    if file_path is not None and not isinstance(file_path, str):
        raise DataError(f'topology node {node_id!r} file must be a string')
    if node.get('description') is not None and not isinstance(node['description'], str):
        raise DataError(f'topology node {node_id!r} description must be a string')
    children = node.get('children', [])
    if not isinstance(children, list):
        raise DataError(f'topology node {node_id!r} children must be an array')
    if len(ids) + len(children) > MAX_NODES:
        raise DataError(f'topology exceeds the {MAX_NODES}-node limit')
    for child in children:
        validate_node(child, ids, leaves, depth + 1)


def validate_topology(topology, require_leaf_references=True):
    if not isinstance(topology, dict) or not isinstance(topology.get('system'), str) or not isinstance(topology.get('root'), dict):
        raise DataError('topology.json must contain string system and object root fields')
    ids, leaves = set(), set()
    validate_node(topology['root'], ids, leaves)
    edges = topology.get('edges', [])
    if not isinstance(edges, list) or len(edges) > MAX_NODES * 4:
        raise DataError('topology edges must be a bounded array')
    for edge in edges:
        if not isinstance(edge, dict) or not isinstance(edge.get('source'), str) or not isinstance(edge.get('target'), str):
            raise DataError('topology edges need string source and target ids')
        if require_leaf_references and (edge['source'] not in leaves or edge['target'] not in leaves):
            raise DataError('topology edge endpoint is not a leaf id')
        if edge.get('kind') not in EDGE_KINDS:
            raise DataError(f"topology edge has unsupported kind: {edge.get('kind')!r}")
    for key in ('entryPoints', 'deadEnds', 'observations'):
        value = topology.get(key, [])
        if not isinstance(value, list) or len(value) > MAX_NODES:
            raise DataError(f'topology {key} must be a bounded array')
        if key == 'observations':
            if any(not isinstance(item, str) for item in value):
                raise DataError('topology observations must contain strings')
        elif any(not isinstance(item, str) or (require_leaf_references and item not in leaves) for item in value):
            raise DataError(f'topology {key} must contain leaf ids')
    flows = topology.get('flows', [])
    if not isinstance(flows, list) or len(flows) > MAX_NODES:
        raise DataError('topology flows must be a bounded array')
    for flow in flows:
        validate_flow(flow)
    return ids, leaves


def validate_flow(flow):
    if not isinstance(flow, dict) or not isinstance(flow.get('name'), str):
        raise DataError('topology flows must contain objects with a string name')
    if not isinstance(flow.get('persona'), str) or not isinstance(flow.get('description'), str):
        raise DataError('flow persona and description must be strings')
    steps = flow.get('steps', [])
    if not isinstance(steps, list) or not 3 <= len(steps) <= 8:
        raise DataError('flow steps must be an array of 3–8 steps')
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get('label'), str) or not isinstance(step.get('nodes', []), list):
            raise DataError('flow steps need a string label and a nodes array')
        if any(not isinstance(node_id, str) for node_id in step.get('nodes', [])):
            raise DataError('flow step nodes must be string ids')


def merge_node(target, fragment):
    if target.get('id') != fragment.get('id'):
        raise DataError('topology fragment node id does not match merge target')
    for key, value in fragment.items():
        if key == 'children':
            continue
        if key not in target or target[key] in (None, '', [], {}):
            target[key] = value
        elif target[key] != value and key in ('name', 'kind', 'file', 'loc'):
            raise DataError(f'topology fragments disagree on node {target["id"]!r} field {key}')
    by_id = {child.get('id'): child for child in target.get('children', []) if isinstance(child, dict)}
    for child in fragment.get('children', []):
        child_id = child.get('id') if isinstance(child, dict) else None
        if child_id in by_id:
            merge_node(by_id[child_id], child)
        else:
            target.setdefault('children', []).append(child)
            if child_id is not None:
                by_id[child_id] = child


def merge_fragment(topology, fragment):
    if not isinstance(fragment, dict):
        raise DataError('topology chunk must be a JSON object')
    if 'root' in fragment:
        if not isinstance(fragment['root'], dict):
            raise DataError('topology chunk root must be an object')
        if fragment['root'].get('id') == topology['root'].get('id'):
            merge_node(topology['root'], fragment['root'])
        else:
            topology['root'].setdefault('children', []).append(fragment['root'])
    elif isinstance(fragment.get('nodes'), list):
        topology['root'].setdefault('children', []).extend(fragment['nodes'])
    for key in ('edges', 'entryPoints', 'deadEnds', 'observations', 'flows'):
        if key in fragment:
            if not isinstance(fragment[key], list):
                raise DataError(f'topology chunk field {key} must be an array')
            topology.setdefault(key, []).extend(fragment[key])
    for key in ('system',):
        if key in fragment and topology.get(key) not in (None, '', fragment[key]):
            raise DataError(f'topology chunk disagrees on {key}')
        if key in fragment:
            topology[key] = fragment[key]


def clean_flows(topology, leaves, notes):
    for flow in topology.get('flows', []):
        for step in flow.get('steps', []):
            kept = []
            for node_id in step.get('nodes', []):
                if node_id in leaves:
                    kept.append(node_id)
                else:
                    notes.append(f"flow {flow['name']!r} step {step['label']!r} references non-leaf node {node_id!r}; omitted")
            step['nodes'] = kept


def packet_text(packet):
    if not isinstance(packet, dict) or not isinstance(packet.get('id'), str):
        raise DataError('node packet must be an object with a string id')
    parts = [packet.get('id', ''), packet.get('name', ''), packet.get('kind', ''), packet.get('loc', ''), packet.get('file', ''), packet.get('headerComment', '')]
    connections = packet.get('connections', [])
    source = packet.get('source', [])
    if not isinstance(connections, list) or not isinstance(source, list):
        raise DataError(f"node packet {packet['id']!r} has invalid connections or source")
    for connection in connections:
        if not isinstance(connection, dict):
            raise DataError('node packet connection must be an object')
        parts.extend((str(connection.get('id', '')), str(connection.get('name', '')), str(connection.get('kind', ''))))
    for segment in source:
        if not isinstance(segment, dict) or not isinstance(segment.get('text'), str):
            raise DataError('node packet source segment must contain text')
        parts.extend((str(segment.get('path', '')), segment['text']))
    return '\n'.join(str(part) for part in parts)


def description_claims_valid(description, evidence):
    evidence = evidence.casefold()
    for value in NUMBER.findall(description):
        if value.casefold() not in evidence:
            return False, f'number {value!r} is absent from its packet'
    matches = list(WORD.finditer(description))
    for index, match in enumerate(matches):
        word = match.group(0)
        if not IDENTIFIER.fullmatch(word):
            continue
        if word.casefold() not in evidence:
            return False, f'identifier {word!r} is absent from its packet'
    # Capitalized names are identifiers unless they begin a sentence.
    for match in matches:
        word = match.group(0)
        before = description[:match.start()].rstrip()
        sentence_start = not before or before[-1] in '.!?'
        if word[:1].isupper() and not sentence_start and word.casefold() not in evidence:
            return False, f'name {word!r} is absent from its packet'
    return True, ''


def word_count(text):
    return len(re.findall(r"\b[\w'-]+\b", text))


def file_id(node_id):
    return hashlib.sha256(node_id.encode('utf-8')).hexdigest()[:16]


def load_packets(assessment, budget):
    directory = os.path.join(assessment, 'node-packets')
    if not os.path.isdir(directory):
        return {}
    if not within(assessment, directory):
        raise DataError('node-packets directory escapes --assessment')
    packets = {}
    for name in sorted(os.listdir(directory)):
        if not name.startswith('packet-') or not name.endswith('.json'):
            continue
        if len(packets) >= MAX_NODES:
            raise DataError(f'node-packets exceeds the {MAX_NODES}-file limit')
        packet = read_json(os.path.join(directory, name), assessment, f'node packet {name}', budget)
        text = packet_text(packet)
        node_id = packet['id']
        if node_id in packets:
            raise DataError(f'duplicate node packet for {node_id!r}')
        packets[node_id] = (packet, text)
    return packets


def apply_descriptions(topology, assessment, leaves, notes, budget):
    directory = os.path.join(assessment, 'node-descriptions')
    if not os.path.isdir(directory):
        return 0, 0
    if not within(assessment, directory):
        raise DataError('node-descriptions directory escapes --assessment')
    packets = load_packets(assessment, budget)
    accepted = rejected = 0
    for node_id in sorted(leaves):
        basename = file_id(node_id)
        json_path = os.path.join(directory, basename + '.json')
        text_path = os.path.join(directory, basename + '.txt')
        if os.path.isfile(json_path):
            raw = read_bytes(json_path, assessment, f'description for {node_id}', MAX_TEXT_BYTES)
            account_input(budget, len(raw))
            try:
                item = json.loads(raw.decode('utf-8-sig'))
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
                raise DataError(f'description for {node_id} is not valid UTF-8 JSON: {error}') from error
            if not isinstance(item, dict) or item.get('id') != node_id or not isinstance(item.get('description'), str):
                raise DataError(f'description file for {node_id} must contain matching id and string description')
            description = item['description'].strip()
        elif os.path.isfile(text_path):
            raw = read_bytes(text_path, assessment, f'description for {node_id}', MAX_TEXT_BYTES)
            account_input(budget, len(raw))
            try:
                description = raw.decode('utf-8-sig').strip()
            except UnicodeDecodeError as error:
                raise DataError(f'description for {node_id} is not valid UTF-8') from error
        else:
            continue
        packet_entry = packets.get(node_id)
        if not packet_entry:
            notes.append(f'description for {node_id!r} omitted: no matching node packet')
            rejected += 1
            continue
        count = word_count(description)
        if count < 55 or count > 90:
            notes.append(f'description for {node_id!r} omitted: {count} words is outside the required 55–90')
            rejected += 1
            continue
        valid, reason = description_claims_valid(description, packet_entry[1])
        if not valid:
            notes.append(f'description for {node_id!r} omitted: {reason}')
            rejected += 1
            continue
        node = find_node(topology['root'], node_id)
        if node is not None:
            node['description'] = description
            accepted += 1
    return accepted, rejected


def find_node(node, node_id):
    if node.get('id') == node_id:
        return node
    for child in node.get('children', []):
        found = find_node(child, node_id)
        if found is not None:
            return found
    return None


def source_commit(source):
    git_dir = os.path.join(source, '.git')
    if not os.path.isdir(git_dir) or not within(source, git_dir):
        return 'not available'
    head_path = os.path.join(git_dir, 'HEAD')
    try:
        raw = read_bytes(head_path, source, 'git HEAD', 1024).decode('ascii').strip()
    except (DataError, UnicodeDecodeError):
        return 'not available'
    if re.fullmatch(r'[0-9a-fA-F]{40,64}', raw):
        return raw.lower()
    if not raw.startswith('ref: '):
        return 'not available'
    ref = raw[5:]
    if not ref or ref.startswith('/') or '..' in ref.split('/'):
        return 'not available'
    ref_path = os.path.join(git_dir, *ref.split('/'))
    if within(source, ref_path) and os.path.isfile(ref_path):
        try:
            value = read_bytes(ref_path, source, 'git ref', 1024).decode('ascii').strip()
            if re.fullmatch(r'[0-9a-fA-F]{40,64}', value):
                return value.lower()
        except (DataError, UnicodeDecodeError):
            return 'not available'
    packed = os.path.join(git_dir, 'packed-refs')
    if os.path.isfile(packed):
        try:
            lines = read_bytes(packed, source, 'git packed refs', 1_000_000).decode('ascii').splitlines()
        except (DataError, UnicodeDecodeError):
            return 'not available'
        for line in lines:
            fields = line.split()
            if len(fields) == 2 and fields[1] == ref and re.fullmatch(r'[0-9a-fA-F]{40,64}', fields[0]):
                return fields[0].lower()
    return 'not available'


def merge(assessment, source, app, source_repository=None, pinned_commit=None):
    budget = [0]
    base_path = os.path.join(assessment, 'topology.json')
    topology = read_json(base_path, assessment, 'topology.json', budget)
    validate_topology(topology, require_leaf_references=False)
    notes = []
    chunks_dir = os.path.join(assessment, 'topology-chunks')
    chunk_count = 0
    if os.path.isdir(chunks_dir):
        if not within(assessment, chunks_dir):
            raise DataError('topology-chunks directory escapes --assessment')
        names = sorted(name for name in os.listdir(chunks_dir) if name.endswith('.json'))
        if len(names) > MAX_FRAGMENTS:
            raise DataError(f'topology-chunks exceeds the {MAX_FRAGMENTS}-file limit')
        for name in names:
            fragment = read_json(os.path.join(chunks_dir, name), assessment, f'topology chunk {name}', budget)
            merge_fragment(topology, fragment)
            chunk_count += 1
    flows_path = os.path.join(assessment, 'flows.json')
    if os.path.isfile(flows_path):
        fragment = read_json(flows_path, assessment, 'flows.json', budget)
        if not isinstance(fragment, dict):
            raise DataError('flows.json must contain a JSON object')
        for key in ('flows', 'observations'):
            if key in fragment:
                if not isinstance(fragment[key], list):
                    raise DataError(f'flows.json field {key} must be an array')
                topology.setdefault(key, []).extend(fragment[key])
    _, leaf_ids = validate_topology(topology)
    descriptions, rejected = apply_descriptions(topology, assessment, leaf_ids, notes, budget)
    clean_flows(topology, leaf_ids, notes)
    topology['edges'] = sorted({
        (edge['source'], edge['target'], edge['kind']): edge for edge in topology.get('edges', [])
    }.values(), key=lambda edge: (edge['source'], edge['target'], edge['kind']))
    topology['entryPoints'] = sorted(set(topology.get('entryPoints', [])))
    topology['deadEnds'] = sorted(set(topology.get('deadEnds', [])))
    topology['observations'] = sorted(set(topology.get('observations', [])))
    flow_by_key = {}
    for flow in topology.get('flows', []):
        flow_by_key[(flow['name'], str(flow.get('persona', '')), str(flow.get('description', '')))] = flow
    topology['flows'] = [flow_by_key[key] for key in sorted(flow_by_key)]
    validate_topology(topology)
    summary = [
        f'# Topology merge — {app}',
        f'Source repository: {source_repository or os.path.basename(os.path.normpath(source))} at {pinned_commit or source_commit(source)}',
        f'Nodes: {len(leaf_ids)} leaves; edges: {len(topology.get("edges", []))}; chunks: {chunk_count}.',
        f'Descriptions: {descriptions} accepted; {rejected} omitted.',
    ]
    summary.extend(f'- {note}' for note in notes)
    return topology, '\n'.join(summary) + '\n'


def write_file(root, name, text):
    if os.path.islink(root):
        raise DataError(f'refusing to write through a symbolic link: {root}')
    os.makedirs(root, exist_ok=True)
    real_root = os.path.realpath(root)
    path = os.path.join(real_root, name)
    temporary = path + '.tmp'
    if not within(real_root, path) or os.path.islink(path) or os.path.islink(temporary):
        raise DataError(f'refusing to write outside --out or through a symbolic link: {path}')
    if len(text.encode('utf-8')) > MAX_OUTPUT_BYTES:
        raise DataError(f'output {name} exceeds the {MAX_OUTPUT_BYTES}-byte limit')
    with open(temporary, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    os.replace(temporary, path)


def valid_commit(value):
    if not re.fullmatch(r'[0-9a-fA-F]{40,64}', value):
        raise argparse.ArgumentTypeError('must be a 40-64 character hexadecimal commit')
    return value.lower()

def main(argv=None):
    parser = argparse.ArgumentParser(description='Merge topology fragments and descriptions into the portal map.')
    parser.add_argument('app', help='application id used in the summary')
    parser.add_argument('--source-commit', type=valid_commit, help='pinned source commit (40-64 hexadecimal characters)')
    parser.add_argument('--source-repo', help='source repository identity label')
    parser.add_argument('--source', required=True, help='read-only source checkout used to identify the source commit')
    parser.add_argument('--assessment', required=True, help='applications/<app>/assessment/ containing topology inputs')
    parser.add_argument('--out', required=True, help='folder where topology.json and topology.summary.txt are written')
    args = parser.parse_args(argv[1:] if argv is not None else None)
    if not args.source.strip() or not args.assessment.strip() or not args.out.strip():
        print('merge_topology.py: --source, --assessment, and --out must be non-empty explicit paths', file=sys.stderr)
        return 1
    source = os.path.realpath(os.path.expanduser(args.source))
    assessment = os.path.realpath(os.path.expanduser(args.assessment))
    out = os.path.abspath(os.path.expanduser(args.out))
    try:
        if not os.path.isdir(source):
            raise DataError(f'--source is not a directory: {args.source}')
        if not os.path.isdir(assessment):
            raise DataError(f'--assessment is not a directory: {args.assessment}')
        if within(source, out):
            raise DataError('--out must be outside the read-only --source checkout')
        topology, summary = merge(assessment, source, args.app, args.source_repo, args.source_commit)
        json_text = json.dumps(topology, ensure_ascii=False, indent=2) + '\n'
        write_file(out, 'topology.json', json_text)
        write_file(out, 'topology.summary.txt', summary)
    except (DataError, OSError, RecursionError) as error:
        print(f'merge_topology.py: {error}', file=sys.stderr)
        return 1
    print(f'topology.json and topology.summary.txt written to {os.path.realpath(out)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
