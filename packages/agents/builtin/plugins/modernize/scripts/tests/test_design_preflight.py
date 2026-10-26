import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import design_preflight as preflight
import scaffold_design
import mark_design_draft
import design_lib
import docmd


class Preflight(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        shutil.copytree(HERE / 'fixtures/design/sets', self.root / '01-standards/templates')
        self.put('kintsugi.yaml', 'unitKinds: [screen, api, batch]\n')
        self.key = 'tax/calc'
        self.legacy = '10-applications/billing/01-legacy/tax/calc'
        self.modern = '10-applications/billing/02-modern/tax/calc'
        self.put(self.modern + '/README.md', '---\nkind: screen\ntitle: Calculate\n---\n')
        self.put('10-applications/billing/01-legacy/_catalog/tax.md', '# Tax\n\n## tax/calc: Calculate\n\n- **kind:** screen\n- **digest:** `sha256:abc`\n- **status:** active\n')
        self.put(self.legacy + '/understanding.md', '---\nstatus: understood\ndigest: sha256:abc\n---\n')
        self.put(self.legacy + '/rules.md', '# Rules\n\nNo business rules were found.\n')
        self.put(self.legacy + '/spec.md', '# Calculate\n\n## Gaps and questions\n\nNone.\n')

    def put(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def test_ready_zero_rule_unit_and_missing_evidence(self):
        self.assertEqual(preflight.unit_blockers(str(self.root), 'billing', self.key), [])
        self.assertEqual(len(preflight.input_blockers()), 4)
        (self.root / self.legacy / 'spec.md').unlink()
        with self.assertRaisesRegex(docmd.DataError, 'not ready for a final design'):
            scaffold_design.scaffold(str(self.root), 'billing', self.key, 'basic', require_ready=True)
        self.assertFalse((self.root / self.modern / 'basic').exists())

    def test_explicit_draft_and_persistent_marker_cannot_satisfy_dependency(self):
        (self.root / self.legacy / 'understanding.md').unlink()
        # Catalog units can be explored as drafts even before understand creates a unit card.
        (self.root / self.modern / 'README.md').unlink()
        out = self.root / 'out'
        info = {}
        created, _ = scaffold_design.scaffold(str(self.root), 'billing', self.key, 'basic', out=str(out), info=info, require_ready=True, draft=True)
        self.assertTrue(created)
        self.assertTrue(info['blockers'])
        manifest = self.put('manifest.json', json.dumps({'units': {self.key: info}}))
        marked = self.root / 'marked'
        self.assertEqual(mark_design_draft.main(['--app', 'billing', '--set', 'basic', '--units', self.key, '--root', str(out), '--out', str(marked), '--manifest', str(manifest)]), 0)
        for path in created:
            text = (marked / path).read_text()
            self.assertIs(docmd.split_front_matter(text)[0]['draft'], True)
            loaded = scaffold_design.check_design.load(str(self.root))[0][0]
            file = design_lib.files_for(loaded, 'screen')[0]
            self.assertIn('draft', [problem['code'] for problem in design_lib.check_document(design_lib.template_of(loaded, file), file['ref'], text, {'ruleIds': [], 'requirementIds': [], 'componentIds': [], 'items': {}})])

    def test_dependency_blocks_final_generation_and_regeneration(self):
        with self.assertRaisesRegex(docmd.DataError, 'conformant basic'):
            scaffold_design.scaffold(str(self.root), 'billing', self.key, 'detail', require_ready=True, regenerate=True)
        created, _ = scaffold_design.scaffold(str(self.root), 'billing', self.key, 'detail', require_ready=True, draft=True)
        self.assertTrue(created)

    def test_gap_status_cannot_clear_blocker_without_answer_and_evidence(self):
        spec = '# Spec\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact | Status | Answer | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Rate? | legacy/tax.cbl:4 | blocking | resolved | TODO | REQ-1 |\n'
        self.put(self.legacy + '/spec.md', spec)
        self.assertTrue(preflight.unit_blockers(str(self.root), 'billing', self.key))
        self.put(self.legacy + '/spec.md', spec.replace('TODO', 'Use 8%.'))
        self.assertEqual(preflight.unit_blockers(str(self.root), 'billing', self.key), [])

    def test_shared_resolution_helper_is_identical_in_both_plugins(self):
        sibling = HERE.parents[2] / 'reverse_engineering/scripts/gap_resolution.py'
        self.assertEqual((HERE.parent / 'gap_resolution.py').read_bytes(), sibling.read_bytes())
