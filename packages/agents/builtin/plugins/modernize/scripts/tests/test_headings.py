"""A template heading with a long run of spaces is read in linear time (T3-011)."""
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import design_lib as dl  # noqa: E402


class HeadingTests(unittest.TestCase):
    def test_a_long_run_of_spaces_is_read_in_linear_time(self):
        started = time.perf_counter()
        found = dl.headings_of([f'# a{" " * 200_000}x', '## Data ##', '```', '# not a heading', '```'])
        self.assertLess(time.perf_counter() - started, 0.5)
        self.assertEqual([(heading['level'], heading['title'], heading['line']) for heading in found], [(1, 'a x', 0), (2, 'Data', 1)])


if __name__ == '__main__':
    unittest.main()
