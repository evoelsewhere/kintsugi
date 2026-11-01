"""The document-repo path layout (ADR-0051), mirroring packages/domain/src/document-layout.ts.

Every script of this plugin builds document-repository paths through this module only, so a layout
change lands here instead of in scattered path literals. Paths are repository-relative with `/`
separators. `unit key` (or `item id`) is the catalog key `<module>/<unit>`. An application has two
halves on the same `<module>/<unit>` paths: `01-legacy/` (the assessment and what is known about each
unit) and `02-modern/` (the unit's card, its design and its task pack). A folder whose name starts
with `_` is never a module. The document repository holds no JSON: committed files are Markdown, and
the JSON a run passes between its steps lives under the scratch directory, which is never committed.
Standard library only.
"""

import re

PROJECT_ROOT = '00-project'
STANDARDS_ROOT = '01-standards'
ARCHITECTURE_ROOT = '02-architecture'
TRANSITION_ROOT = '03-transition'
APPLICATIONS_ROOT = '10-applications'
SPACES_ROOT = '20-spaces'
SCRATCH_ROOT = 'scratch'
PAGE_TEMPLATES_DIR = f'{STANDARDS_ROOT}/page-templates'
SPACE_TEMPLATES = '_templates'
ATTACHMENTS = '_attachments'
DESIGN_SETS_ROOT = f'{STANDARDS_ROOT}/templates'
INPUTS = '00-inputs'
LEGACY = '01-legacy'
MODERN = '02-modern'
GENERATED = '_generated'
UNIT_CARD = 'README.md'
_SEGMENT = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}\Z')


# ---------------------------------------------------------------------------
# The legacy repositories of a run (ADR-0052), mirroring packages/domain/src/source.ts
# ---------------------------------------------------------------------------

_SOURCE_FOLDER = re.compile(r'^[a-z0-9][a-z0-9._-]{0,127}\Z', re.IGNORECASE)
_COMMIT = re.compile(r'^[0-9a-f]{40}([0-9a-f]{24})?\Z')


def is_source_folder(name):
    """Whether `name` can be the id (the mount folder) of a legacy repository: one safe path segment."""
    return bool(_SOURCE_FOLDER.match(name))


def parse_sources(spec):
    """[(repository id, commit)] of a spec `id@commit,id@commit`: one source folder under `as-is/` each, in order.
    Raises ValueError when the spec is not well formed."""
    sources = []
    for part in spec.split(','):
        pieces = part.strip().split('@')
        if len(pieces) != 2 or not _SOURCE_FOLDER.match(pieces[0]) or not _COMMIT.match(pieces[1]):
            raise ValueError(f'not a source "<repository id>@<commit>": {part.strip()[:80]}')
        if any(repo == pieces[0] for repo, _ in sources):
            raise ValueError(f'repository {pieces[0]} is listed twice')
        sources.append((pieces[0], pieces[1]))
    return sources


def sources_spec(sources):
    return ','.join(f'{repo}@{commit}' for repo, commit in sources)


def split_source_path(cited, sources):
    """(repository id, path inside it) of a cited `<repository id>/<path>`, None when its first segment is not one of `sources`."""
    repo, slash, path = cited.partition('/')
    return (repo, path) if slash and any(repo == known for known, _ in sources) else None


def split_unit_key(unit_key):
    """(module, unit) of a `<module>/<unit>` key."""
    module, unit = unit_key.split('/', 1)
    return module, unit


def is_unit_segment(name):
    """Whether a folder name can be a module or a unit (folders starting with `_` belong to the application)."""
    return bool(_SEGMENT.match(name))


# ---------------------------------------------------------------------------
# Project level
# ---------------------------------------------------------------------------

def standards_dir():
    return STANDARDS_ROOT


def specification_profiles_dir():
    """The project's specification profiles by item kind (ADR-0060): `<kind>.md` files."""
    return f'{STANDARDS_ROOT}/specifications'


def glossary_path():
    return f'{PROJECT_ROOT}/glossary.md'


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

def applications_dir():
    return APPLICATIONS_ROOT


def application_dir(app):
    return f'{applications_dir()}/{app}'


def application_inputs_dir(app):
    return f'{application_dir(app)}/{INPUTS}'


def application_input_path(app, file):
    return f'{application_inputs_dir(app)}/{file}'


def legacy_dir(app):
    """The old system's half: the assessment at its top, a folder per understood unit."""
    return f'{application_dir(app)}/{LEGACY}'


def modern_dir(app):
    """The new system's half: requirements, the application's design, a folder per unit."""
    return f'{application_dir(app)}/{MODERN}'


def application_requirements_path(app):
    return f'{modern_dir(app)}/requirements.md'


def application_design_path(app):
    return f'{modern_dir(app)}/design.md'


# ---------------------------------------------------------------------------
# Design context (ADR-0044, ADR-0045, ADR-0050)
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


def design_profile_path(set_id, kind):
    return f'{design_set_dir(set_id)}/{kind}/profile.md'


def application_design_dir(app):
    return f'{modern_dir(app)}/_design'


def application_design_set_dir(app, set_id):
    return f'{application_design_dir(app)}/{set_id}'


def application_design_file_path(app, set_id, file):
    return f'{application_design_set_dir(app, set_id)}/{file}'


# ---------------------------------------------------------------------------
# Assessment context: the top of the legacy half
# ---------------------------------------------------------------------------

def assessment_dir(app):
    return legacy_dir(app)


def assessment_file_path(app, file):
    return f'{assessment_dir(app)}/{file}'


def assessment_inventory_path(app):
    return assessment_file_path(app, 'inventory.md')


def assessment_topology_path(app):
    return assessment_file_path(app, 'topology.md')


def assessment_synthesis_path(app):
    return assessment_file_path(app, 'assessment.md')


def assessment_diagram_path(app):
    return assessment_file_path(app, 'architecture.mmd')


def assessment_catalog_dir(app):
    return assessment_file_path(app, '_catalog')


def assessment_catalog_path(app):
    """The catalog's index: its modules and items, one table row each."""
    return f'{assessment_catalog_dir(app)}/index.md'


def assessment_catalog_module_path(app, module):
    return f'{assessment_catalog_dir(app)}/{module}.md'


def assessment_analysis_dir(app):
    return assessment_file_path(app, '_analysis')


def assessment_tools_dir(app):
    return assessment_file_path(app, '_tools')


def topology_extractor_path(app):
    return f'{assessment_tools_dir(app)}/extract_topology.py'


# ---------------------------------------------------------------------------
# Understanding context, application level
# ---------------------------------------------------------------------------

def understand_plan_path(app):
    return f'{legacy_dir(app)}/plan.md'


# ---------------------------------------------------------------------------
# Wiki: team spaces, page ids, attachments (ADR-0096)
# ---------------------------------------------------------------------------

# The scope of page ids: an uppercase short name of a space, written in its home page's `key` (2 to 10 characters).
_PAGE_KEY = re.compile(r'^[A-Z][A-Z0-9]{1,9}\Z')
_PAGE_ID = re.compile(r'^PAGE-([A-Z][A-Z0-9]{1,9})-([0-9]{4,9})\Z')
_PAGE_NUMBER_MAX = 999_999_999
_ATTACHMENT_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')

# The file types a page may keep in its `_attachments/` folder (ADR-0096 decision 6); SVG waits for its sanitiser.
ATTACHMENT_EXTENSIONS = ('png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf')

# What no wiki or Brain reader treats as a page: roots that hold member plugins and run scratch, and folders that
# hold restricted records and allocation ledgers (ADR-0075). Hidden folders are excluded too, by their name.
DOCUMENT_EXCLUDED_ROOTS = ('plugins', SCRATCH_ROOT)
DOCUMENT_EXCLUDED_FOLDERS = ('restricted', 'identifiers')


def _is_plain_folder(path):
    """Whether every segment of a repository-relative folder path is plain: not empty, not `.`, `..` or hidden."""
    return path != '' and '\\' not in path and all(part != '' and not part.startswith('.') for part in path.split('/'))


def _require_space(space):
    if not is_unit_segment(space):
        raise ValueError(f'"{space}" cannot name a space')
    return space


def spaces_dir():
    return SPACES_ROOT


def space_dir(space):
    """A team space is one folder under `20-spaces/`; `space` is a segment (`is_unit_segment`)."""
    return f'{SPACES_ROOT}/{_require_space(space)}'


def space_home_path(space):
    """The space's home page: front matter `title` and `key`, then the text of the page."""
    return f'{space_dir(space)}/{UNIT_CARD}'


def space_templates_dir(space):
    return f'{space_dir(space)}/{SPACE_TEMPLATES}'


def page_templates_dir():
    """The page templates every space of the project may use."""
    return PAGE_TEMPLATES_DIR


def is_page_key(key):
    """Whether `key` can scope page ids: uppercase letters and digits, a letter first, 2 to 10 characters."""
    return bool(_PAGE_KEY.match(key))


def page_id(key, number):
    """The id of a page: `PAGE-<KEY>-<nnnn>`, the number counted from 1 and padded to four digits."""
    if not is_page_key(key):
        raise ValueError(f'"{key}" cannot scope page ids')
    if isinstance(number, bool) or not isinstance(number, int) or number < 1 or number > _PAGE_NUMBER_MAX:
        raise ValueError(f'{number} cannot number a page')
    return f'PAGE-{key}-{number:04d}'


def is_page_id(value):
    return bool(_PAGE_ID.match(value))


def parse_page_id(value):
    """(key, number) of a page id, None for anything else."""
    match = _PAGE_ID.match(value)
    return (match.group(1), int(match.group(2))) if match else None


def page_folder(page_path):
    """The folder a page file sits in, which also holds its `_attachments/` folder; '' for a file at the root."""
    return page_path.rpartition('/')[0]


def is_attachment_name(file):
    """Whether `file` is one safe file name: a letter or digit first, then letters, digits, `.`, `_` and `-`."""
    return bool(_ATTACHMENT_NAME.match(file))


def is_attachment_type(file):
    """Whether `file` has the extension of an allowed attachment type, in any letter case."""
    stem, dot, extension = file.rpartition('.')
    return bool(dot) and bool(stem) and extension.lower() in ATTACHMENT_EXTENSIONS


def page_attachments_dir(page_dir):
    """The folder of the files that belong to the pages of `page_dir` (files beside the page)."""
    if not _is_plain_folder(page_dir):
        raise ValueError(f'"{page_dir}" cannot hold attachments')
    return f'{page_dir}/{ATTACHMENTS}'


def page_attachment_path(page_dir, file):
    if not is_attachment_name(file):
        raise ValueError(f'"{file}" cannot name an attachment')
    return f'{page_attachments_dir(page_dir)}/{file}'


def is_stage_written_path(path):
    """Whether a stage writes the document: the legacy and modern halves of an application and its read models."""
    parts = path.split('/')
    return (len(parts) > 3 and parts[0] == APPLICATIONS_ROOT and is_unit_segment(parts[1])
            and parts[2] in (LEGACY, MODERN, GENERATED))


def is_wiki_editable_path(path):
    """Whether the wiki editor may write the path: a Markdown page, or an attachment of an allowed type in an
    `_attachments/` folder; every segment plain; outside plugins, scratch, restricted records, identifier ledgers
    and `_generated/`; not written by a stage. `kintsugi.yaml` is neither a page nor an attachment."""
    parts = path.split('/')
    name = parts[-1]
    attachment = len(parts) > 1 and parts[-2] == ATTACHMENTS and is_attachment_name(name) and is_attachment_type(name)
    if not attachment and not path.lower().endswith('.md'):
        return False
    if '\\' in path or any(part == '' or part.startswith('.') for part in parts):
        return False
    if parts[0] in DOCUMENT_EXCLUDED_ROOTS:
        return False
    if any(part.lower() in DOCUMENT_EXCLUDED_FOLDERS or part.lower() == GENERATED for part in parts):
        return False
    return not is_stage_written_path(path)


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


def design_run_dir(app):
    return scratch_file_path(app, 'design')


def design_manifest_path(app):
    return f'{design_run_dir(app)}/manifest.json'


def design_review_path(app, unit_key):
    name = '_application' if unit_key == '@app' else unit_key
    return f'{design_run_dir(app)}/review/{name}.md'


def design_review_report_path(app):
    return f'{design_run_dir(app)}/review-report.json'


def design_summary_path(app):
    return f'{design_run_dir(app)}/review.md'


def design_report_path(app):
    return f'{design_run_dir(app)}/report.json'


def design_map_path(app):
    return f'{design_run_dir(app)}/map.json'


def design_contract_path(app, cluster):
    return f'{design_run_dir(app)}/contract/{cluster}.md'


def design_progress_path(app):
    return f'{design_run_dir(app)}/progress.json'


def design_coverage_path(app):
    return f'{design_run_dir(app)}/coverage.json'


def design_loop_path(app):
    return f'{design_run_dir(app)}/loop.json'


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


def understand_reads_path(app, unit_key):
    return understand_run_file_path(app, f'reads/{unit_key}.json')


# ---------------------------------------------------------------------------
# Generated read models
# ---------------------------------------------------------------------------

def generated_dir(app):
    return f'{application_dir(app)}/{GENERATED}'


def generated_file_path(app, file):
    return f'{generated_dir(app)}/{file}'


# ---------------------------------------------------------------------------
# Units: the same <module>/<unit> path in both halves
# ---------------------------------------------------------------------------

def legacy_module_dir(app, module):
    return f'{legacy_dir(app)}/{module}'


def modern_module_dir(app, module):
    return f'{modern_dir(app)}/{module}'


def unit_legacy_dir(app, module, unit):
    """What is known about the unit, written by the understanding context."""
    return f'{legacy_module_dir(app, module)}/{unit}'


def unit_modern_dir(app, module, unit):
    """What is built for the unit: its card, its design and its task pack."""
    return f'{modern_module_dir(app, module)}/{unit}'


def unit_legacy_file_path(app, module, unit, file):
    return f'{unit_legacy_dir(app, module, unit)}/{file}'


def unit_modern_file_path(app, module, unit, file):
    return f'{unit_modern_dir(app, module, unit)}/{file}'


def unit_key_legacy_path(app, unit_key, file):
    module, unit = split_unit_key(unit_key)
    return unit_legacy_file_path(app, module, unit, file)


def unit_key_modern_path(app, unit_key, file):
    module, unit = split_unit_key(unit_key)
    return unit_modern_file_path(app, module, unit, file)


def unit_state_path(app, module, unit):
    """The unit's card: its state (front matter) and what it is built from and into."""
    return unit_modern_file_path(app, module, unit, UNIT_CARD)


def unit_key_state_path(app, unit_key):
    return unit_key_modern_path(app, unit_key, UNIT_CARD)


def unit_as_is_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'spec.md')


def unit_key_as_is_path(app, unit_key):
    return unit_key_legacy_path(app, unit_key, 'spec.md')


def unit_understanding_path(app, module, unit):
    """The unit's provenance record; its presence on the default branch means "understood"."""
    return unit_legacy_file_path(app, module, unit, 'understanding.md')


def unit_rules_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'rules.md')


def unit_rules_dir(app, module, unit):
    """The folder of the unit's rule files, one `<rule id>.md` per rule; rules.md is their index."""
    return unit_legacy_file_path(app, module, unit, 'rules')


def unit_rule_file_path(app, module, unit, rule_id):
    return f'{unit_rules_dir(app, module, unit)}/{rule_id}.md'


def unit_data_objects_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'data-objects.md')


def unit_rules_review_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'rules-review.md')


def identifier_registry_file(kind):
    """Relative to the reference owner's document folder."""
    if kind not in ('rules', 'findings', 'gaps'):
        raise ValueError('invalid identifier registry kind')
    return f'identifiers/{kind}-ids.md'


def unit_identifier_registry_path(app, module, unit, kind):
    """Independent allocation history per unit and reference type (ADR-0075)."""
    return unit_legacy_file_path(app, module, unit, identifier_registry_file(kind))


def unit_findings_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'findings.md')


def unit_topology_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'topology.md')


def unit_trace_path(app, module, unit):
    return unit_legacy_file_path(app, module, unit, 'trace.md')


def unit_task_path(app, module, unit):
    return unit_modern_file_path(app, module, unit, 'task.md')


def unit_design_set_dir(app, module, unit, set_id):
    return unit_modern_file_path(app, module, unit, set_id)


def unit_design_file_path(app, module, unit, set_id, file):
    return f'{unit_design_set_dir(app, module, unit, set_id)}/{file}'


# ---------------------------------------------------------------------------
# Review of a member's build (ADR-0071)
# ---------------------------------------------------------------------------


def build_run_dir(app):
    return scratch_file_path(app, 'build')


def build_run_file_path(app, file):
    return f'{build_run_dir(app)}/{file}'


def build_manifest_path(app):
    return build_run_file_path(app, 'manifest.json')


def build_changes_path(app):
    return build_run_file_path(app, 'changes.json')


def build_review_note_path(app, unit_key):
    return build_run_file_path(app, f'review/{unit_key}.md')


def build_review_report_path(app):
    return build_run_file_path(app, 'review-report.json')


def build_parity_path(app):
    return build_run_file_path(app, 'parity.json')


def build_summary_path(app):
    return build_run_file_path(app, 'summary.md')


def unit_key_build_dir(app, unit_key):
    return f'{modern_dir(app)}/{unit_key}/_build'


def unit_code_review_path(app, unit_key):
    return f'{unit_key_build_dir(app, unit_key)}/review.md'


def design_previous_path(app, unit_key, set_id, file):
    subject = '_application' if unit_key == '@app' else unit_key
    return f'{design_run_dir(app)}/previous/{subject}/{set_id}/{file}'
