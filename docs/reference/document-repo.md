# Document repository layout

> Status: this page describes paths written or consumed by the current implementation. The subject-oriented layout change has not been applied yet.

Each project has exactly one document repo. It holds everything except code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)). The portal does not scaffold this repo from the starter template today; see [Build a project](../guides/build-project.md).

This page answers where current artifacts live. For focused contracts, see the [manifest](document-repo-manifest.md), [item catalog](document-repo-item-catalog.md), [write path](document-repo-write-path.md), [read path and stage results](document-repo-read-path.md), [commit conventions](document-repo-commit-conventions.md), and [unit file format](document-repo-unit-files.md).

## One placement rule in the current implementation

- Project-wide configuration and authored content live at the repo root: `kintsugi.yaml`, `standards/`, and project member plugins in `plugins/`.
- Application assessment inputs and `assess` outputs live under `assessment/<app>/`.
- `understand` evidence for a selected unit is written under `assessment/<app>/items/<module>/<unit>/` and `knowledge/as-is/<app>/`; the unit's indexed state file is `units/<app>/<module>/<unit>.md`.
- Application aggregates rebuilt by `rebuild_aggregates.py` live under the two `generated/` directories shown below.

This documents current code paths, not the proposed subject-based target. The template and plans do not yet provide homes for the P0 charter and policies, the P1 cross-application portfolio, P2 TO-BE requirements/design, P6 cutover, P7 operation or uniform gate records. Current unit gate state remains in unit frontmatter. Those target homes and the shared gate-record format are not scaffolded by current plans.

## Current paths

```text
kintsugi.yaml
standards/
  conventions/
  mappings/
  review-rules.md
plugins/<project-plugin>/
assessment/<app>/
  INTENT.md                         # optional human-provided assessment input
  graph/                            # optional human-provided graph input
  telemetry/                        # optional human-provided telemetry input
  analysis/                         # assess analysis outputs
  catalog-draft/                    # assess catalog proposal
  inventory.json                    # assess script output
  topology.json                     # topology extraction output
  catalog.json                      # curated item catalog
  ASSESSMENT.md                     # assess synthesis
  ARCHITECTURE.mmd                  # assess synthesis
  tools/extract_topology.py         # generated extraction script used by assess
  understand/briefs/                # per-unit understand briefs
  items/<module>/<unit>/            # per-unit topology.json, rules.json, findings.json
  generated/                         # rebuilt application aggregates:
    topology.json
    rules_result.json
    BUSINESS_RULES.md
    DATA_OBJECTS.md
    SECURITY_FINDINGS.md
knowledge/as-is/<app>/
  <module>/<unit>.md                 # per-unit AS-IS specification
  items/<module>/<unit>/             # per-unit meta.json and trace.json
  generated/                         # rebuilt application indexes and views:
    README.md
    traceability.json
    traceability.md
units/<app>/<module>/<unit>.md       # unit state, indexed by the API
```

### Member modernization and verification paths

The current member plugin commands also use `assessment/<app>/MODERNIZATION_BRIEF.md`, `assessment/<app>/modules/<module>/TRANSFORMATION_NOTES.md`, and `assessment/<app>/VERIFICATION.md` / `VERIFICATION.json`. Baseline inputs and captured legacy outputs live under `golden/<module>/`; per-run reports live under `runs/<module>/<run-id>/`. These are member-plugin paths, separate from the `assess`/`understand` plan outputs above.

In these current verification paths, `<module>` is the module slug and does not include `<app>`; it is not the full unit id `<app>/<module>/<unit>`. The member workflow documents specify `tasks/<id>.md` for task-planner output and `reviews/<id>/` for gate-reviewer records. These are not outputs of the built-in `assess`/`understand` plans, have no `<app>` directory component, and do not define whether `<id>` is a short slug or a full unit id. `deliverables/<phase>` has no writer in the current code and is not a supported path. The proposed Phase C layout moves unit-specific task, review and verification content under `applications/<app>/units/<module>/<unit>/`.

The exact files emitted by the assess and understand plans are described in the [item catalog page](document-repo-item-catalog.md). Aggregates are rebuilt from merged per-unit files; see [commit conventions](document-repo-commit-conventions.md) for the current auto-commit paths.

In path examples, `<module>/<unit>` is the catalog item id. The full unit id is `<app>/<module>/<unit>`; `<unit>` is only the last path segment, not the full id. The API still exposes legacy `WorkItem`/`work-items` names; this reference uses **unit** for the concept and **item** only for a catalog entry.

## Generated and authored content

- Files under `assessment/<app>/generated/` and `knowledge/as-is/<app>/generated/` are aggregates written by `rebuild_aggregates.py`, not hand-authored sources.
- `assessment/<app>/tools/extract_topology.py` is also generated, but it is a stage tool rather than an aggregate. The word `generated` in that filename does not make it an aggregate directory.
- The template's `plugins/` contains project-authored member plugin sources only.
- The built-in copy `plugins/kintsugi/` and harness fallback renderings are planned outputs; the built-in plugin generator is not implemented yet.
- `packages/harness-sdk` declares three planned marketplace output paths: `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and `.agents/plugins/marketplace.json`. No current code writes these files; they are generated outputs, not authored sources or template content.

## Repository model

The document repo is a Git repository registered with role `document`; application code repositories use `legacy`, `legacy-data`, or `target` roles. The document repo is the source of truth for project documents and records, while Postgres indexes unit state and Git history records changes ([ADR-0019](../decisions/0019-workspace-repo-write-path.md), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)).

## Related references

- [Delivery pipeline](../methodology/delivery-pipeline.md) explains P0–P7 and gates G0–G6.
- [Build a project](../guides/build-project.md) describes the currently available setup flow and the planned portal scaffold behavior.
- [ADR-0033](../decisions/0033-assess-catalog-understand-selection.md) defines the `assess` item catalog and selected-unit `understand` stages.
