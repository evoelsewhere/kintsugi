#!/usr/bin/env python3
"""Check the planner's draft against the item graph and write the plan (ADR-0041).

    python3 check_plan.py <app> --draft FILE --graph FILE --out DIR [--max-batch 12] [--max-batches 8]

--draft is the planning agent's structured answer ({strategy, batches: [{title, items, rationale, risk}],
leftOut: [{item, reason}]}); --graph the plan_graph.py output (both scratch JSON of the run); --out the
document-repository root the plan is written under (applications/<app>/understanding/plan.md).

The agent proposes, this script decides what stands: an item that is not in the catalog, is understood
already, is test or generated code, or is named in an earlier batch is dropped (with the reason, in
`dropped`); a batch over --max-batch keeps its first items and drops the rest; an emptied batch goes.
Every batch then gets what only the graph can say: its size, how many items are high complexity, how
tightly it holds together (calls inside the batch against calls out of it) and the items outside it
that it depends on and that are not understood yet. A draft with no batch left fails: the stage's
repair step gives the agent the reason once. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

RISKS = ('high', 'medium', 'low')
MAX_TITLE = 100
MAX_TEXT = 600


def dropped(item, reason):
    return {'item': cc.clean_text(item, 130), 'reason': reason}


def check(app, draft, graph, max_batch, max_batches):
    if not isinstance(draft, dict) or not isinstance(draft.get('batches'), list):
        raise cc.DataError('the draft must be an object with a batches list')
    by_id = {item['id']: item for item in graph['items']}
    taken, batches, drops = set(), [], []
    for raw in draft['batches']:
        if not isinstance(raw, dict) or not isinstance(raw.get('items'), list):
            continue
        members = []
        for value in raw['items']:
            item_id = value if isinstance(value, str) else ''
            item = by_id.get(item_id)
            if item is None:
                drops.append(dropped(item_id, 'not an item of the catalog'))
            elif item['understood']:
                drops.append(dropped(item_id, 'understood already'))
            elif item['assetClass'] != 'code':
                drops.append(dropped(item_id, f"{item['assetClass']} code is not planned"))
            elif item_id in taken:
                drops.append(dropped(item_id, 'already in an earlier batch'))
            elif len(members) >= max_batch:
                drops.append(dropped(item_id, f'a batch holds at most {max_batch} items'))
            else:
                members.append(item_id)
                taken.add(item_id)
        if not members:
            continue
        batches.append({
            'title': cc.clean_text(raw.get('title'), MAX_TITLE) or f'Batch {len(batches) + 1}',
            'rationale': cc.clean_text(raw.get('rationale'), MAX_TEXT),
            'risk': raw.get('risk') if raw.get('risk') in RISKS else 'medium',
            'items': members,
        })
        if len(batches) >= max_batches:
            break
    if not batches:
        raise cc.DataError('no batch is left: every item named is unknown, understood, test or generated code, or repeated; name items of the catalog that are open')

    placed = {}
    for number, batch in enumerate(batches, 1):
        for item_id in batch['items']:
            placed[item_id] = number
    for number, batch in enumerate(batches, 1):
        inside = set(batch['items'])
        internal = external = 0
        outside = {}
        for item_id in batch['items']:
            for dependency in by_id[item_id]['dependsOn']:
                target = dependency['item']
                if target in inside:
                    internal += dependency['edges']
                else:
                    external += dependency['edges']
                    if not by_id[target]['understood'] and placed.get(target, number + 1) > number:
                        outside.setdefault(target, []).append(item_id)
        loc = sum(by_id[item_id]['loc'] for item_id in batch['items'])
        batch.update({
            'n': number,
            'loc': loc,
            'high': sum(1 for item_id in batch['items'] if by_id[item_id]['complexity'] == 'high'),
            'cohesion': None if internal + external == 0 else round(internal / (internal + external), 2),
            'dependsOutside': [{'item': target, 'usedBy': sorted(users)} for target, users in sorted(outside.items())],
        })

    left_out = []
    for entry in draft.get('leftOut') or []:
        if isinstance(entry, dict) and isinstance(entry.get('item'), str) and entry['item'] in by_id and entry['item'] not in taken:
            left_out.append({'item': entry['item'], 'reason': cc.clean_text(entry.get('reason'), 300)})
    open_items = sum(1 for item in graph['items'] if not item['understood'] and item['assetClass'] == 'code')
    return {
        'version': 1,
        'app': app,
        'generatedBy': 'plan_understand',
        'strategy': cc.clean_text(draft.get('strategy'), 1200),
        'catalog': {'commit': (graph.get('source') or {}).get('commit'), 'items': len(graph['items']), 'open': open_items},
        'batches': batches,
        'leftOut': left_out[:200],
        'dropped': drops[:200],
        'summary': {'batches': len(batches), 'planned': len(taken), 'open': open_items},
    }


def render_plan(plan):
    """plan.md: front matter with the totals, the strategy, one section per batch, what was left out and dropped."""
    summary = plan['summary']
    out = [
        docmd.front_matter({
            'version': plan['version'],
            'app': plan['app'],
            'generatedBy': plan['generatedBy'],
            'catalogCommit': plan['catalog'].get('commit') or '',
            'items': plan['catalog']['items'],
            'open': plan['catalog']['open'],
            'batches': summary['batches'],
            'planned': summary['planned'],
        }),
        f'# Plan to understand {plan["app"]}',
        '',
        plan['strategy'] or 'No strategy was given.',
        '',
    ]
    for batch in plan['batches']:
        out += [
            docmd.heading(2, f'Batch {batch["n"]}', batch['title']),
            '',
            batch['rationale'] or 'No rationale was given.',
            '',
            docmd.field_lines({
                'risk': batch['risk'],
                'loc': batch['loc'],
                'high complexity': batch['high'],
                'cohesion': '' if batch['cohesion'] is None else batch['cohesion'],
            }),
            '### Items',
            '',
            docmd.bullet_list(batch['items']),
        ]
        if batch['dependsOutside']:
            out += ['### Depends on outside', '', docmd.table(['Item', 'Used by'], [[dep['item'], ', '.join(dep['usedBy'])] for dep in batch['dependsOutside']])]
    if plan['leftOut']:
        out += ['## Left out', '', docmd.table(['Item', 'Reason'], [[entry['item'], entry['reason']] for entry in plan['leftOut']])]
    if plan['dropped']:
        out += ['## Dropped', '', 'Named by the planner and refused by the check.', '', docmd.table(['Item', 'Reason'], [[entry['item'], entry['reason']] for entry in plan['dropped']])]
    return '\n'.join(out).rstrip() + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description='Check the planner\'s draft against the item graph and write the plan.')
    ap.add_argument('app')
    ap.add_argument('--draft', required=True)
    ap.add_argument('--graph', required=True)
    ap.add_argument('--out', required=True, help='the document-repository root to write under')
    ap.add_argument('--max-batch', type=int, default=12)
    ap.add_argument('--max-batches', type=int, default=8)
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        graph = cc.read_json(args.graph, 'graph.json')
        if not isinstance(graph, dict) or not isinstance(graph.get('items'), list):
            raise cc.DataError('graph.json must be an object with an items list')
        plan = check(args.app, cc.read_json(args.draft, 'the draft'), graph, args.max_batch, args.max_batches)
        docmd.write_text(os.path.join(os.path.abspath(args.out), *paths.understand_plan_path(args.app).split('/')), render_plan(plan))
    except (cc.DataError, OSError) as error:
        print(f'check_plan.py: {error}', file=sys.stderr)
        return 1
    summary = plan['summary']
    print(f"{summary['batches']} batch(es), {summary['planned']} of {summary['open']} open item(s) planned, {len(plan['dropped'])} dropped")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
