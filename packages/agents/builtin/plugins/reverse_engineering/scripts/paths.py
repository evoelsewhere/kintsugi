"""The document-repo path layout (ADR-0042), mirroring packages/domain/src/document-layout.ts.

Every script of this plugin builds document-repository paths through this module only, so a layout
change lands here instead of in scattered path literals. Paths are repository-relative with `/`
separators. `unit key` (or `item id`) is the catalog key `<module>/<unit>`. The document repository
holds no JSON: committed files are Markdown, and the JSON a run passes between its steps lives under
the scratch directory, which is never committed. Standard library only.
"""

APPLICATIONS_ROOT = 'applications'
SCRATCH_ROOT = 'scratch'
ARCHITECTURE_ROOT = 'architecture'
DESIGN_SETS_ROOT = 'standards/design'


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


def application_to_be_dir(app):
    return f'{application_dir(app)}/to-be'


def application_requirements_path(app):
    return f'{application_to_be_dir(app)}/requirements.md'


def application_design_path(app):
    return f'{application_to_be_dir(app)}/design.md'


# ---------------------------------------------------------------------------
# Design context (ADR-0044, ADR-0045)
# ---------------------------------------------------------------------------

def architecture_dir():
    return ARCHITECTURE_ROOT


def common_components_dir():
    return f'{ARCHITECTURE_ROOT}/common'


def common_component_path(component_id):
    return f'{common_components_dir()}/{component_id}.md'


def design_sets_dir():
    return DESIGN_SETS_ROOT


def design_set_dir(set_id):
    return f'{design_sets_dir()}/{set_id}'


def design_set_path(set_id):
    return f'{design_set_dir(set_id)}/set.md'


def design_template_path(set_id, template):
    return f'{design_set_dir(set_id)}/{template}'


# ---------------------------------------------------------------------------
# Assessment context
# ---------------------------------------------------------------------------

def assessment_dir(app):
    return f'{application_dir(app)}/assessment'


def assessment_file_path(app, file):
    return f'{assessment_dir(app)}/{file}'


def assessment_inventory_path(app):
    return assessment_file_path(app, 'inventory.md')


def assessment_topology_path(app):
    return assessment_file_path(app, 'topology.md')


def assessment_catalog_dir(app):
    return assessment_file_path(app, 'catalog')


def assessment_catalog_path(app):
    """The catalog's index: its modules and items, one table row each."""
    return f'{assessment_catalog_dir(app)}/index.md'


def assessment_catalog_module_path(app, module):
    return f'{assessment_catalog_dir(app)}/{module}.md'


def assessment_analysis_dir(app):
    return assessment_file_path(app, 'analysis')


def assessment_tools_dir(app):
    return assessment_file_path(app, 'tools')


def topology_extractor_path(app):
    return f'{assessment_tools_dir(app)}/extract_topology.py'


# ---------------------------------------------------------------------------
# Understanding context
# ---------------------------------------------------------------------------

def application_understanding_dir(app):
    return f'{application_dir(app)}/understanding'


def understand_plan_path(app):
    return f'{application_understanding_dir(app)}/plan.md'


# ---------------------------------------------------------------------------
# Scratch: job-to-job data of one run (JSON, never committed, not part of the layout)
# ---------------------------------------------------------------------------

def scratch_dir(app):
    return f'{SCRATCH_ROOT}/{app}'


def scratch_file_path(app, file):
    return f'{scratch_dir(app)}/{file}'


def scratch_inventory_path(app):
    return scratch_file_path(app, 'inventory.json')


def scratch_topology_path(app):
    return scratch_file_path(app, 'topology.json')


def scratch_catalog_draft_dir(app):
    return scratch_file_path(app, 'catalog-draft')


def scratch_catalog_path(app):
    return scratch_file_path(app, 'catalog.json')


def understand_run_dir(app):
    return scratch_file_path(app, 'understand')


def understand_run_file_path(app, file):
    return f'{understand_run_dir(app)}/{file}'


def understand_scope_path(app):
    return understand_run_file_path(app, 'scope.json')


def understand_graph_path(app):
    return understand_run_file_path(app, 'graph.json')


def understand_plan_draft_path(app):
    return understand_run_file_path(app, 'plan-draft.json')


def understand_shards_path(app):
    return understand_run_file_path(app, 'shards.json')


def understand_scan_path(app):
    return understand_run_file_path(app, 'scan.json')


def understand_rules_result_path(app):
    return understand_run_file_path(app, 'rules_result.json')


def assessment_briefs_dir(app):
    return f'{understand_run_dir(app)}/briefs'


def assessment_brief_path(app, unit_key):
    return f'{assessment_briefs_dir(app)}/{unit_key}.json'


def understand_trace_draft_path(app, unit_key):
    return understand_run_file_path(app, f'trace/{unit_key}.json')


# ---------------------------------------------------------------------------
# Generated read models
# ---------------------------------------------------------------------------

def generated_dir(app):
    return f'{application_dir(app)}/generated'


def generated_file_path(app, file):
    return f'{generated_dir(app)}/{file}'


# ---------------------------------------------------------------------------
# The Unit aggregate
# ---------------------------------------------------------------------------

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


def unit_understanding_dir(app, module, unit):
    return unit_file_path(app, module, unit, 'understanding')


def unit_understanding_file_path(app, module, unit, file):
    return f'{unit_understanding_dir(app, module, unit)}/{file}'


def unit_key_understanding_path(app, unit_key, file):
    module, unit = split_unit_key(unit_key)
    return unit_understanding_file_path(app, module, unit, file)


def unit_as_is_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'as-is.md')


def unit_key_as_is_path(app, unit_key):
    return unit_key_understanding_path(app, unit_key, 'as-is.md')


def unit_understanding_path(app, module, unit):
    """The unit's provenance record; its presence on the default branch means "understood"."""
    return unit_understanding_file_path(app, module, unit, 'understanding.md')


def unit_rules_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'rules.md')


def unit_rules_dir(app, module, unit):
    """The folder of the unit's rule files, one `<rule id>.md` per rule; rules.md is their index."""
    return unit_understanding_file_path(app, module, unit, 'rules')


def unit_rule_file_path(app, module, unit, rule_id):
    return f'{unit_rules_dir(app, module, unit)}/{rule_id}.md'


def unit_data_objects_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'data-objects.md')


def unit_rules_review_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'rules-review.md')


def unit_findings_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'findings.md')


def unit_topology_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'topology.md')


def unit_trace_path(app, module, unit):
    return unit_understanding_file_path(app, module, unit, 'trace.md')


def unit_task_path(app, module, unit):
    return unit_file_path(app, module, unit, 'task.md')


def unit_design_dir(app, module, unit):
    return unit_file_path(app, module, unit, 'design')


def unit_design_set_dir(app, module, unit, set_id):
    return f'{unit_design_dir(app, module, unit)}/{set_id}'


def unit_design_file_path(app, module, unit, set_id, file):
    return f'{unit_design_set_dir(app, module, unit, set_id)}/{file}'


def unit_reviews_dir(app, module, unit):
    return unit_file_path(app, module, unit, 'reviews')


def unit_gate_review_path(app, module, unit, gate='G4'):
    return f'{unit_reviews_dir(app, module, unit)}/{gate}.md'
