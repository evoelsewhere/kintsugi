"""Evidence and dependencies checked before any designer is started. No approval is inferred."""
import os
import docmd
import paths
import gap_resolution


def read(root, relative):
    path = os.path.join(root, *relative.split('/'))
    return docmd.read_text(path) if os.path.isfile(path) and not os.path.islink(path) else None


def catalog_item(root, app, key):
    module, _ = paths.split_unit_key(key)
    text = read(root, paths.assessment_catalog_module_path(app, module)) or ''
    for title, body in docmd.sections(text, 2):
        ident, name = docmd.split_heading(title)
        if ident == key:
            _, fields, _ = docmd.parse_card(body, 2)
            if fields.get('status') == 'retired':
                return None
            return {**fields, 'name': name, 'kind': fields.get('kind') or 'module'}
    return None


def input_blockers(specification=None, understanding=None, rules=None, review=None, catalog_digest=None):
    blockers = []
    record = docmd.split_front_matter(understanding or '')[0]
    if record.get('status') != 'understood':
        blockers.append('Understand the unit and merge its pull request first.')
    if not catalog_digest or record.get('digest') != catalog_digest:
        blockers.append('The understanding is not current with the active catalog; run understand again.')
    if 'profileMissing' in record and record['profileMissing'] != []:
        blockers.append('The understanding is missing specification-profile sections.')
    if not specification or not specification.strip():
        blockers.append('The merged AS-IS specification is missing.')
    else:
        rows, problems = gap_resolution.inspect(specification)
        blockers.extend(problems)
        blockers.extend(f'Resolve {row["id"]} in the specification: {row["question"]}' for row in rows if row.get('impact') == 'blocking' and not gap_resolution.resolved(row))
    if not rules or not rules.strip():
        blockers.append('The merged rules document is missing; understand the unit first.')
    else:
        verdicts = {docmd.uncode(row.get('rule', '')).strip(): row.get('verdict', '').lower() for row in docmd.records_in(review or '')}
        candidates = docmd.records_in(rules)
        # Older rule cards remain readable, as in the TypeScript rules reader.
        for title, body in docmd.sections(rules, 3):
            ident, _ = docmd.split_heading(title)
            if ident:
                import re
                confidence = re.search(r'\*\*Confidence:\*\*\s*(\w+)', body, re.I)
                candidates.append({'id': ident, 'confidence': confidence[1] if confidence else ''})
        import re
        if not any(row.get('id') for row in candidates) and docmd.split_front_matter(rules)[0].get('rules') != 0 and not re.search(r'no business rules (?:were )?(?:found|confirmed)', rules, re.I):
            blockers.append('The rules document has no readable rules or explicit zero-rule result.')
        for row in candidates:
            ident = docmd.uncode(row.get('id', '')).strip()
            if not ident or row.get('status') == 'retired':
                continue
            verdict = verdicts.get(ident)
            if verdict == 'clarify' or (verdict not in ('confirmed', 'refuted') and (row.get('status') == 'needs-sme' or (row.get('confidence') and row['confidence'].lower() != 'high'))):
                blockers.append(f'Resolve rule {ident} with its evidence and rule review before design.')
    return blockers


def unit_blockers(root, app, key):
    module, unit = paths.split_unit_key(key)
    item = catalog_item(root, app, key)
    return input_blockers(read(root, paths.unit_as_is_path(app, module, unit)), read(root, paths.unit_understanding_path(app, module, unit)),
                          read(root, paths.unit_rules_path(app, module, unit)), read(root, paths.unit_rules_review_path(app, module, unit)),
                          (item or {}).get('digest'))


def dependency_blockers(root, app, key, loaded, sets, unit):
    import design_lib as dl
    import check_design
    problems = []
    for need in loaded['set']['needs']:
        needed = next((entry for entry in sets if entry['set']['id'] == need), None)
        if needed is None:
            problems.append(f'Needs the merged, conformant {need} design first.')
            continue
        target = dl.APPLICATION_KEY if needed['set']['scope'] == 'application' else key
        if not dl.files_for(needed, None if target == dl.APPLICATION_KEY else unit['kind']):
            continue
        try:
            report = check_design.check_unit(root, app, target, need)
            if not report['ok']:
                problems.append(f'Needs the merged, conformant {need} design first.')
        except (docmd.DataError, OSError):
            problems.append(f'Needs the merged, conformant {need} design first.')
    return problems
