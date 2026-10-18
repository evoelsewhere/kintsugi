# Document repository layout

> Status: this page describes the ADR-0038 target layout. Paths are written by Kintsugi code, by people through pull requests, or are marked planned with the phase that will fill them.

Each project has exactly one document repo. It holds everything except code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)). The layout groups content by subject (program, portfolio, architecture, application, unit) and by SDLC phase ([ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md)). The portal does not scaffold this repo from the starter template today; see [Build a project](../guides/build-project.md).

This page answers where artifacts live. For focused contracts, see the [manifest](document-repo-manifest.md), [item catalog](document-repo-item-catalog.md), [write path](document-repo-write-path.md), [read path and stage results](document-repo-read-path.md), [commit conventions](document-repo-commit-conventions.md), and [unit file format](document-repo-unit-files.md).

## Vocabulary

A **unit** is the thing being migrated. Its id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is only the last segment, not the full id. An **item** is only an entry in an application's assessment catalog (`<module>/<item>`); once selected for migration, a catalog item becomes a unit. Use "unit" for the thing and "item" only for a catalog entry. The API still exposes legacy `WorkItem`/`work-items` names.

## The layout

```text
kintsugi.yaml                  project manifest (written by the portal's publish, arrives as a pull request)
program/                       P0: charter.md, raci.md, ai-strategy.md, kpi-baseline.md, ai-usage-policy.md
portfolio/                     P1: scorecard.md, dispositions.md, wave-plan.md
architecture/                  P2: blueprint.md, coexistence.md, data-migration.md, poc-plan.md, adr/
standards/                     P2-P3: conventions/, mappings/, review-rules.md
plugins/                       P3: project-authored plugins only
gates/                         project-level gate records: G0.md, G3.md
applications/<app>/
  inputs/                      INTENT.md, graph/, telemetry/ attached by people
  assessment/                  P1 assess and understand outputs
  to-be/                       P2: requirements.md, design.md
  gates/                       G1.md, G2.md, G5.md, G6.md
  units/<module>/<unit>/       P1-P5: one directory per unit (see the unit file page)
  cutover/                     P6: plan.md, runbook.md, rollback.md, go-no-go.md
  operate/                     P7: hypercare-report.md, handover.md
  generated/                   rebuilt application aggregates
```

## Who writes what

- **Written by code**: the `assess` job writes `applications/<app>/assessment/` (catalog, synthesis, topology and its views, extraction results) and the `understand` job writes the per-unit evidence under `applications/<app>/units/<module>/<unit>/` (`as-is.md`, `topology.json`, `rules.json`, `findings.json`, `trace.json`, `meta.json`). After a merge, `rebuild_aggregates.py` rebuilds the application aggregates under `applications/<app>/generated/` (`topology.json`, `rules_result.json`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.json`, `traceability.md`, `README.md`) and commits them to the default branch; the application overview documents (`architecture.md`, `data-model.md`, `integrations.md`) are written by an on-demand Overview run.
- **Written by people, through pull requests**: `program/`, `portfolio/`, `architecture/`, `standards/`, `plugins/`, `applications/<app>/inputs/`, `applications/<app>/cutover/`, `applications/<app>/operate/`, all gate records, and the human rule verdicts in `rules-review.json`.
- **Planned**: `applications/<app>/to-be/requirements.md` and `design.md` (P2 target specification; no writer is implemented yet), the per-unit `reviews/G4.md` records and the `unit.md` gate references (P4), and the per-unit `verify/` evidence (P5).

## Gate records

A gate record is a Markdown file whose body records:

```text
- Decision:            approved / rejected / pending
- Approvers:           names and roles
- Evidence:            paths in this repository supporting the decision
- Date:                YYYY-MM-DD
```

Project-level records live in `gates/` (G0 bootstrap, G3 pilot exit and factory readiness); application records live in `applications/<app>/gates/` (G1 portfolio decision, G2 target architecture, G5 test exit and UAT, G6 go / no-go). A unit's G4 record lives under the unit's `reviews/` and its `unit.md` frontmatter points to it. Gate records arrive through pull requests and are never auto-committed. The format is scaffolded as placeholders only; there is no gate-record automation.

## Auto-commit

Straight-to-default-branch commits are limited to the default auto-commit paths:

```text
applications/*/units/**/unit.md
applications/*/units/**/task.md
applications/*/generated/**
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as a pull request from a `kintsugi/<user>/<write-id>` branch ([commit conventions](document-repo-commit-conventions.md)).

## Generated and authored content

- Files under `applications/<app>/generated/` are aggregates rebuilt from the merged unit files, never hand-authored sources.
- `applications/<app>/assessment/understand/` holds run scratch (scope, shards, scan results); it is working area, not evidence.
- The template's `plugins/` contains project-authored member plugin sources only.
- The built-in copy `plugins/kintsugi/` and harness fallback renderings are planned outputs; the built-in plugin generator is not implemented yet.
- `packages/harness-sdk` declares three planned marketplace output paths: `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and `.agents/plugins/marketplace.json`. No current code writes these files; they are generated outputs, not authored sources or template content.

## Repository model

The document repo is a Git repository registered with role `document`; application code repositories use `legacy`, `legacy-data`, or `target` roles. The document repo is the source of truth for project documents and records, while Postgres indexes unit state and Git history records changes ([ADR-0019](../decisions/0019-workspace-repo-write-path.md), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)).

## Related references

- [Delivery pipeline](../methodology/delivery-pipeline.md) explains P0–P7 and gates G0–G6.
- [Build a project](../guides/build-project.md) describes the currently available setup flow and the planned portal scaffold behavior.
- [ADR-0033](../decisions/0033-assess-catalog-understand-selection.md) defines the `assess` item catalog and selected-unit `understand` stages; its layout statements are superseded by [ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md).
