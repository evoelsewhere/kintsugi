"""One line of a document must not hold a step (T3-011): the heading pattern backtracked cubically on a long run of
spaces, the front-matter pattern quadratically. The linear readers give the same results as the patterns did."""
import os
import random
import re
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import docmd  # noqa: E402
import gaps_common  # noqa: E402
import reconcile_catalog  # noqa: E402

SPACES = ' ' * 200_000


def old_heading(line, deepest):
    match = re.match(r'^(#{1,%d})\s+(.+?)\s*#*\s*$' % deepest, line)
    return (match.group(1), match.group(2)) if match else None


class HeadingTests(unittest.TestCase):
    def quickly(self, read):
        started = time.perf_counter()
        result = read()
        self.assertLess(time.perf_counter() - started, 0.5)
        return result

    def test_every_line_is_read_as_the_pattern_it_replaces_read_it(self):
        lines = ['# Title', '## Title ##', '### a b c   ', '# C# notes', '# x #y', '#nospace', '# ', '#  ', '#### Deep ###   ',
                 '# a #', '# #', '# C#', '# a ## ##', '####### seven', '#\ttab', '# a\rb', '## Gaps\n', '# \n', '#  \n', '# a\nb', '#\na']
        rng = random.Random(5)
        alphabet = ['#', ' ', '\t', 'a', '\r', '\n', '\xa0']
        for _ in range(5000):
            lines.append('#' * rng.randrange(8) + ''.join(rng.choice(alphabet) for _ in range(rng.randrange(9))))
        for line in lines:
            for deepest in (6, 2):
                self.assertEqual(docmd.heading_of(line, deepest), old_heading(line, deepest), repr(line))

    def test_a_long_run_of_spaces_is_read_in_linear_time(self):
        titles = self.quickly(lambda: [title for title, _ in docmd.sections(f'# a{SPACES}x\n\nbody\n', 1)])
        self.assertEqual(titles, [f'a{SPACES}x'])
        text = f'# Spec\n\n## a{SPACES}x\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact |\n|---|---|---|---|---|\n\n## b{SPACES}y\n'
        self.quickly(lambda: gaps_common.spec_gaps(text))
        self.quickly(lambda: gaps_common.assign_gap_ids(text, 'CARD01'))
        self.quickly(lambda: gaps_common.carry_resolutions(text, text, True))

    def test_a_front_matter_value_with_a_long_run_of_spaces_is_read_in_linear_time(self):
        # The longest run a unit card can hold: it is read only up to MAX_UNIT_BYTES.
        spaces = ' ' * (reconcile_catalog.MAX_UNIT_BYTES - 100)
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, 'unit.md')
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(f'---\nid: a{spaces}x\ntitle:   Invoice entry   \n---\n')
            unit = self.quickly(lambda: reconcile_catalog.unit_file(path))
        self.assertEqual(unit['id'], f'a{spaces}x')
        self.assertEqual(unit['title'], 'Invoice entry')


if __name__ == '__main__':
    unittest.main()
