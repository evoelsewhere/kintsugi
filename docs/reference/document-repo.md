# Document repository layout

> Status: this page describes the layout of [ADR-0051](../decisions/0051-document-repo-layout-legacy-and-modern.md) (it replaces the tree of ADR-0042, which replaced ADR-0038). Paths are written by Kintsugi code, by people through pull requests, or are marked planned with the phase that will fill them. The repo holds no JSON: every document is Markdown ([document formats](document-formats.md)).

Each project has exactly one document repo. It holds everything except code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)). Its root folders are numbered in reading order; inside an application, the old system and the new one are two halves on the same `<module>/<unit>` paths ([ADR-0051](../decisions/0051-document-repo-layout-legacy-and-modern.md), the [context map](../architecture/concepts/document-repo-contexts.md)). The SDLC phases and gates follow [ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md); gate decisions are recorded in the portal, not in the repo. The portal does not scaffold this repo from the starter template today; see [Build a project](../guides/build-project.md).

This page answers where artifacts live. For focused contracts, see the [manifest](document-repo-manifest.md), [item catalog](document-repo-item-catalog.md), [write path](document-repo-write-path.md), [read path and stage results](document-repo-read-path.md), [commit conventions](document-repo-commit-conventions.md), [unit file format](document-repo-unit-files.md), [design templates](design-templates.md) and [document formats](document-formats.md).

## Vocabulary

A **unit** is the thing being migrated. Its id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is only the last segment, not the full id. An **item** is only an entry in an application's catalog (`<module>/<item>`); once selected for migration, a catalog item becomes a unit. Use "unit" for the thing and "item" only for a catalog entry. The API still exposes legacy `WorkItem`/`work-items` names.

## The layout

```text
kintsugi.yaml                  project manifest (written by the portal's publish, arrives as a pull request)
00-project/                    P0-P1: charter.md, raci.md, ai-strategy.md, ai-usage-policy.md, kpi-baseline.md, glossary.md,
                               portfolio/ (scorecard.md, wave-plan.md); traceability.md (planned, generated)
01-standards/                  P2-P3: conventions/, mappings/, review-rules.md, templates/<set>/ (the design sets)
02-architecture/               P2: blueprint.md, poc-plan.md, adr/, common/<COM-id>.md (the common components)
03-transition/                 P2-P4: coexistence.md, data-migration.md, shared-data/ (master data, shared formats)
10-applications/<app>/
  README.md                    the application's overview
  00-inputs/                   INTENT.md, graph/, telemetry/ attached by people
  01-legacy/                   the old system (P1)
    inventory.md topology.md assessment.md architecture.mmd    the assessment
    _catalog/                  the item catalog: index.md and <module>.md
    _tools/                    extract_topology.py, the extraction script the assess job wrote
    plan.md                    the AI plan of what to understand next (advice)
    <module>/<unit>/           what is known about a unit (see the unit file page)
  02-modern/                   the new system (P2-P4)
    requirements.md            the requirements record
    design.md                  the application's own design, written with the common design
    _design/<set>/             the design sets of scope `application`
    <module>/<unit>/           the unit's card README.md, its design sets <set>/, task.md
    <module>/TRANSFORMATION_NOTES.md
  _generated/                  read models rebuilt after a merge, and the Overview run's documents
plugins/                       P3: project-authored member plugins
```

A folder whose name starts with `_` belongs to the application and is never a module: module and unit segments start with a letter or a digit. The JSON a run passes between its steps lives in the job workspace under `scratch/<app>/` and is never committed.

## Who writes what

- **Written by code**: the `assess` job writes the top of `10-applications/<app>/01-legacy/` (the inventory and topology summaries, `_catalog/`, the synthesis `assessment.md` and its diagram, `_tools/`), the `plan-understand` job writes `01-legacy/plan.md`, and the `understand` job writes the per-unit documents under `01-legacy/<module>/<unit>/` (`spec.md`, `understanding.md`, `rules.md` and `rules/`, `data-objects.md`, `findings.md`, `topology.md`, `trace.md`) and proposes the unit's card `02-modern/<module>/<unit>/README.md`. The `design` job writes the design documents of the selected units under `02-modern/<module>/<unit>/<set>/` and, for a set of scope `application`, of the application under `02-modern/_design/<set>/` (the sets the project defines, ADR-0049, ADR-0050). After a merge, `rebuild_aggregates.py` rebuilds the read models under `10-applications/<app>/_generated/` (`BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.md`, `README.md`) and commits them to the default branch; the application overview documents (`architecture.md`, `data-model.md`, `integrations.md`) are written by an on-demand Overview run.
- **Written by members in their harness, through pull requests** ([ADR-0044](../decisions/0044-design-phase-common-basic-detail.md)): the common design in `02-architecture/` (including `common/`), `02-modern/requirements.md` and `02-modern/design.md`, and corrections to each unit's design, from the project's own [design templates](design-templates.md).
- **Written by people, through pull requests**: `00-project/`, `01-standards/` (including `01-standards/templates/`, the design sets), `02-architecture/`, `03-transition/`, `plugins/`, `10-applications/<app>/00-inputs/`, the human rule verdicts in `rules-review.md`, and the `waived` list of a unit's card.
- **Planned**: `00-project/traceability.md`, a project-wide matrix generated from the applications' `_generated/traceability.md`, and `_generated/gate-log.md`, a read-only rendering of the application's gate decisions.

## Gates

Gate decisions (G0-G4 and stage gates) are requested, approved, rejected or waived in the portal (Governance → Gates); each request and decision is audited. The portal decision remains authoritative. For evidence-bound Coding Agent Workflow continuation, Kintsugi publishes a readable record under 10-applications/<app>/02-modern/<module>/<unit>/reviews/ as a reviewed pull request. The record is a Git proof of the decision and its exact deliverables; it becomes effective only after merge and validation. It does not replace the audited decision in the portal ([gate-record contract](gate-records.md), ADR-0054).

## Auto-commit

Straight-to-default-branch commits are limited to the default auto-commit paths:

```text
10-applications/*/02-modern/*/*/README.md
10-applications/*/02-modern/*/*/task.md
10-applications/*/_generated/**
10-applications/*/01-legacy/plan.md
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as a pull request from a `kintsugi/<user>/<write-id>` branch ([commit conventions](document-repo-commit-conventions.md)).

## Generated and authored content

- Files under `10-applications/<app>/_generated/` are aggregates rebuilt from the merged unit files, never hand-authored sources.
- The template's `plugins/` contains project-authored member plugin sources only.
- The built-in copy `plugins/kintsugi/` and harness fallback renderings are planned outputs; the built-in plugin generator is not implemented yet.
- `packages/harness-sdk` declares three planned marketplace output paths: `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and `.agents/plugins/marketplace.json`. No current code writes these files; they are generated outputs, not authored sources or template content.

## Repository model

The document repo is a Git repository registered with role document; application code repositories use legacy, legacy-data, or target roles. Git is the source of truth for project documents and member deliverables. Postgres indexes unit state and stores audited gate decisions; a published evidence record is accepted only at its validated merge revision ([ADR-0019](../decisions/0019-workspace-repo-write-path.md), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md), [ADR-0054](../decisions/0054-evidence-bound-pr-continuation.md)).

## Related references

- [Delivery pipeline](../methodology/delivery-pipeline.md) explains P0–P4 and gates G0–G4.
- [Build a project](../guides/build-project.md) describes the currently available setup flow and the planned portal scaffold behavior.
- [ADR-0033](../decisions/0033-assess-catalog-understand-selection.md) defines the `assess` item catalog and selected-unit `understand` stages; its layout statements are superseded by [ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md), [ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md) and [ADR-0051](../decisions/0051-document-repo-layout-legacy-and-modern.md).
