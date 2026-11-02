"""The wiki fixture of the Brain eval is what make_wiki.py writes (ADR-0097)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import make_wiki  # noqa: E402


def test_the_fixture_is_what_make_wiki_writes():
    assert make_wiki.current(make_wiki.ROOT) == make_wiki.FILES


def test_every_page_has_front_matter_and_a_title_heading():
    for path, text in make_wiki.FILES.items():
        if path == 'README.md' or not path.endswith('.md'):
            continue
        lines = text.split('\n')
        assert lines[0] == '---', path
        assert any(line.startswith('# ') for line in lines), path
