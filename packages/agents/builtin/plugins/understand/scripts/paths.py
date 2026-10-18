"""The document-repo path layout (ADR-0038), mirroring packages/domain/src/document-layout.ts.

Every script of this plugin builds document-repository paths through this module only, so a layout
change lands here instead of in scattered path literals. Paths are repository-relative with `/`
separators. `unit key` (or `item id`) is the catalog key `<module>/<unit>`. Standard library only.
"""

APPLICATIONS_ROOT = 'applications'


def split_unit_key(unit_key):
    """(module, unit) of a `<module>/<unit>` key."""
    module, unit = unit_key.split('/', 1)
    return module, unit


def applications_dir():
    return APPLICATIONS_ROOT


def application_dir(app):
    return f'{applications_dir()}/{app}'


def application_inputs_dir(app):
    return f'{application_dir(app)}/inputs'


def application_input_path(app, file):
    return f'{application_inputs_dir(app)}/{file}'


def application_assessment_dir(app):
    return f'{application_dir(app)}/assessment'


def application_to_be_dir(app):
    return f'{application_dir(app)}/to-be'


def application_requirements_path(app):
    return f'{application_to_be_dir(app)}/requirements.md'


def application_design_path(app):
    return f'{application_to_be_dir(app)}/design.md'


def assessment_dir(app):
    return application_assessment_dir(app)


def assessment_file_path(app, file):
    return f'{assessment_dir(app)}/{file}'


def assessment_inventory_path(app):
    return assessment_file_path(app, 'inventory.json')


def assessment_topology_path(app):
    return assessment_file_path(app, 'topology.json')


def assessment_catalog_path(app):
    return assessment_file_path(app, 'catalog.json')


def assessment_analysis_dir(app):
    return assessment_file_path(app, 'analysis')


def assessment_catalog_draft_dir(app):
    return assessment_file_path(app, 'catalog-draft')


def assessment_tools_dir(app):
    return assessment_file_path(app, 'tools')


def topology_extractor_path(app):
    return f'{assessment_tools_dir(app)}/extract_topology.py'


def assessment_items_dir(app):
    """Compatibility name: unit documents live with their subject, not under assessment."""
    return units_dir(app)


def assessment_item_dir(app, item_id):
    return f'{assessment_items_dir(app)}/{item_id}'


def assessment_item_file_path(app, item_id, file):
    return f'{assessment_item_dir(app, item_id)}/{file}'


def assessment_briefs_dir(app):
    return f'{understand_run_dir(app)}/briefs'


def assessment_brief_path(app, unit_key):
    return f'{assessment_briefs_dir(app)}/{unit_key}.json'


def understand_run_dir(app):
    return f'{assessment_dir(app)}/understand'


def understand_run_file_path(app, file):
    return f'{understand_run_dir(app)}/{file}'


def understand_scope_path(app):
    return understand_run_file_path(app, 'scope.json')


def understand_shards_path(app):
    return understand_run_file_path(app, 'shards.json')


def understand_scan_path(app):
    return understand_run_file_path(app, 'scan.json')


def understand_rules_result_path(app):
    return understand_run_file_path(app, 'rules_result.json')


def generated_dir(app):
    return f'{application_dir(app)}/generated'


def generated_file_path(app, file):
    return f'{generated_dir(app)}/{file}'


def knowledge_as_is_dir(app):
    """Compatibility name: unit AS-IS documents now live in their unit folder."""
    return units_dir(app)


def knowledge_as_is_items_dir(app):
    return units_dir(app)


def knowledge_as_is_item_dir(app, item_id):
    return assessment_item_dir(app, item_id)


def knowledge_as_is_item_file_path(app, item_id, file):
    return assessment_item_file_path(app, item_id, file)


def knowledge_as_is_unit_path(app, unit_key):
    """Compatibility name for the per-unit AS-IS document."""
    return unit_key_path(app, unit_key, 'as-is.md')


def knowledge_as_is_generated_dir(app):
    return generated_dir(app)


def knowledge_as_is_generated_file_path(app, file):
    return generated_file_path(app, file)


def units_dir(app):
    return f'{application_dir(app)}/units'


def unit_module_dir(app, module):
    return f'{units_dir(app)}/{module}'


def unit_dir(app, module, unit):
    return f'{unit_module_dir(app, module)}/{unit}'


def unit_file_path(app, module, unit, file):
    return f'{unit_dir(app, module, unit)}/{file}'


def unit_key_dir(app, unit_key):
    module, unit = split_unit_key(unit_key)
    return unit_dir(app, module, unit)


def unit_key_path(app, unit_key, file):
    module, unit = split_unit_key(unit_key)
    return unit_file_path(app, module, unit, file)


def unit_state_path(app, module, unit):
    return unit_file_path(app, module, unit, 'unit.md')


def unit_as_is_path(app, module, unit):
    return unit_file_path(app, module, unit, 'as-is.md')


def unit_rules_path(app, module, unit):
    return unit_file_path(app, module, unit, 'rules.json')


def unit_rules_review_path(app, module, unit):
    return unit_file_path(app, module, unit, 'rules-review.json')


def unit_findings_path(app, module, unit):
    return unit_file_path(app, module, unit, 'findings.json')


def unit_topology_path(app, module, unit):
    return unit_file_path(app, module, unit, 'topology.json')


def unit_trace_path(app, module, unit):
    return unit_file_path(app, module, unit, 'trace.json')


def unit_meta_path(app, module, unit):
    return unit_file_path(app, module, unit, 'meta.json')


def unit_task_path(app, module, unit):
    return unit_file_path(app, module, unit, 'task.md')


def unit_design_path(app, module, unit):
    return unit_file_path(app, module, unit, 'design.md')


def unit_reviews_dir(app, module, unit):
    return unit_file_path(app, module, unit, 'reviews')


def unit_gate_review_path(app, module, unit, gate='G4'):
    return f'{unit_reviews_dir(app, module, unit)}/{gate}.md'


def unit_verify_dir(app, module, unit):
    return unit_file_path(app, module, unit, 'verify')


def unit_golden_dir(app, module, unit):
    return f'{unit_verify_dir(app, module, unit)}/golden'


def unit_runs_dir(app, module, unit):
    return f'{unit_verify_dir(app, module, unit)}/runs'
