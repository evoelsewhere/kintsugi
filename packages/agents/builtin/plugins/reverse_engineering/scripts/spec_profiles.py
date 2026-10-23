#!/usr/bin/env python3
"""Specification profiles by item kind (ADR-0060): the sections an AS-IS specification has beyond the base ones.

    python3 spec_profiles.py check SPEC.md PROFILE.md      # prints the profile sections the specification lacks

A profile is a Markdown file with front matter `kind` and `version` (an integer), a `## Sections` table
(`Section | What it holds | Evidence`) and a `## Instructions` section. The built-in ones are the files of
skills/understand-planning/references/spec-profiles/; a project replaces one, as a whole file, with
01-standards/specifications/<kind>.md of its document repository. Standard library only.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402

BUILTIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, 'skills', 'understand-planning', 'references', 'spec-profiles')
KIND_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
MAX_SECTIONS = 20
MAX_NAME = 80
MAX_CELL = 400
MAX_INSTRUCTIONS = 4000


def parse(text, kind):
    """(profile, problems) of a profile document; profile is None when it cannot be used."""
    fields, body = docmd.split_front_matter(text)
    problems = []
    if fields.get('kind') != kind:
        problems.append(f'its front matter kind is {str(fields.get("kind"))[:40]!r}, not {kind!r}')
    version = fields.get('version')
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        problems.append('its front matter version is not a positive integer')
    parts = dict(docmd.sections(body, 2))
    rows = docmd.records_in(parts.get('Sections', ''))
    sections, seen = [], set()
    for row in rows:
        name = docmd.clean_text(docmd.uncode(row.get('section', '')), MAX_NAME)
        if not name:
            continue
        if name.lower() in seen:
            problems.append(f'section {name!r} is listed twice')
            continue
        seen.add(name.lower())
        sections.append({'name': name, 'holds': docmd.clean_text(row.get('what it holds', ''), MAX_CELL), 'evidence': docmd.clean_text(row.get('evidence', ''), MAX_CELL)})
    if not sections:
        problems.append('its Sections table has no section')
    if len(sections) > MAX_SECTIONS:
        problems.append(f'it lists more than {MAX_SECTIONS} sections')
    if problems:
        return None, problems
    return {'kind': kind, 'version': version, 'sections': sections, 'instructions': parts.get('Instructions', '').strip()[:MAX_INSTRUCTIONS]}, []


def load(kind, standards_dir=None, builtin_dir=BUILTIN_DIR):
    """(profile, notes): the project's profile of the kind when it is usable, else the built-in one, else None.
    `notes` says why a project file was not used."""
    notes = []
    if not isinstance(kind, str) or not KIND_RE.match(kind):
        return None, notes
    for source, directory in (('project', standards_dir), ('builtin', builtin_dir)):
        if not directory:
            continue
        path = os.path.join(directory, kind + '.md')
        text = docmd.read_optional_text(path)
        if text is None:
            continue
        profile, problems = parse(text, kind)
        if profile is not None:
            return {**profile, 'source': source}, notes
        notes.append(f'{source} profile of {kind}: {"; ".join(problems)}')
    return None, notes


def _normal(title):
    return re.sub(r'\s+', ' ', re.sub(r'^\s*\d+[.)]\s*', '', title)).strip().lower()


def missing_sections(profile, spec_text):
    """The names of the profile's sections the specification has no `##` heading for."""
    have = {_normal(title) for title, _ in docmd.sections(spec_text, 2)}
    return [section['name'] for section in profile['sections'] if _normal(section['name']) not in have]


def main(argv):
    if len(argv) != 4 or argv[1] != 'check':
        print('usage: spec_profiles.py check SPEC.md PROFILE.md', file=sys.stderr)
        return 2
    fields, _ = docmd.split_front_matter(docmd.read_text(argv[3]))
    profile, problems = parse(docmd.read_text(argv[3]), str(fields.get('kind')))
    if profile is None:
        print(f'spec_profiles.py: {"; ".join(problems)}', file=sys.stderr)
        return 1
    missing = missing_sections(profile, docmd.read_text(argv[2]))
    for name in missing:
        print(name)
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
