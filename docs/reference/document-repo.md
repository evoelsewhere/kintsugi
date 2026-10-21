# Document repository layout

> Status: this page describes the layout of [ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md) (it replaces the tree of ADR-0038). Paths are written by Kintsugi code, by people through pull requests, or are marked planned with the phase that will fill them. The repo holds no JSON in the contexts converted so far: every document is Markdown ([document formats](document-formats.md)).

Each project has exactly one document repo. It holds everything except code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)). The layout groups content by subject (program, portfolio, architecture, application, unit) and, inside an application, by bounded context ([ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md), the [context map](../architecture/concepts/document-repo-contexts.md)); the SDLC phases and gates follow [ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md). The portal does not scaffold this repo from the starter template today; see [Build a project](../guides/build-project.md).

This page answers where artifacts live. For focused contracts, see the [manifest](document-repo-manifest.md), [item catalog](document-repo-item-catalog.md), [write path](document-repo-write-path.md), [read path and stage results](document-repo-read-path.md), [commit conventions](document-repo-commit-conventions.md), [unit file format](document-repo-unit-files.md) and [document formats](document-formats.md).

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
  assessment/                  Assessment context (P1): inventory.md, topology.md, catalog/, ASSESSMENT.md, tools/
  understanding/               Understanding context: plan.md (the AI plan, advice)
  to-be/                       P2: requirements.md, design.md
  gates/                       G1.md, G2.md, G5.md, G6.md
  units/<module>/<unit>/       the Unit aggregate (P1-P5): unit.md at the root, understanding/ for what is known (see the unit file page)
  cutover/                     P6: plan.md, runbook.md, rollback.md, go-no-go.md
  operate/                     P7: hypercare-report.md, handover.md
  generated/                   read models rebuilt after a merge
```

The JSON a run passes between its steps lives in the job workspace under `scratch/<app>/` and is never committed.

## Who writes what

- **Written by code**: the `assess` job writes `applications/<app>/assessment/` (the inventory and topology summaries, the catalog, the synthesis, the extraction script), the `plan-understand` job writes `applications/<app>/understanding/plan.md`, and the `understand` job writes the per-unit documents under `applications/<app>/units/<module>/<unit>/understanding/` (`as-is.md`, `understanding.md`, `rules.md`, `data-objects.md`, `findings.md`, `topology.md`, `trace.md`). After a merge, `rebuild_aggregates.py` rebuilds the read models under `applications/<app>/generated/` (`BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.md`, `README.md`) and commits them to the default branch; the application overview documents (`architecture.md`, `data-model.md`, `integrations.md`) are written by an on-demand Overview run.
- **Written by people, through pull requests**: `program/`, `portfolio/`, `architecture/`, `standards/`, `plugins/`, `applications/<app>/inputs/`, `applications/<app>/cutover/`, `applications/<app>/operate/`, all gate records, and the human rule verdicts in `rules-review.md`.
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
applications/*/understanding/plan.md
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as a pull request from a `kintsugi/<user>/<write-id>` branch ([commit conventions](document-repo-commit-conventions.md)).

## Generated and authored content

- Files under `applications/<app>/generated/` are aggregates rebuilt from the merged unit files, never hand-authored sources.
- The template's `plugins/` contains project-authored member plugin sources only.
- The built-in copy `plugins/kintsugi/` and harness fallback renderings are planned outputs; the built-in plugin generator is not implemented yet.
- `packages/harness-sdk` declares three planned marketplace output paths: `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and `.agents/plugins/marketplace.json`. No current code writes these files; they are generated outputs, not authored sources or template content.

## Repository model

The document repo is a Git repository registered with role `document`; application code repositories use `legacy`, `legacy-data`, or `target` roles. The document repo is the source of truth for project documents and records, while Postgres indexes unit state and Git history records changes ([ADR-0019](../decisions/0019-workspace-repo-write-path.md), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)).

## Related references

- [Delivery pipeline](../methodology/delivery-pipeline.md) explains P0–P7 and gates G0–G6.
- [Build a project](../guides/build-project.md) describes the currently available setup flow and the planned portal scaffold behavior.
- [ADR-0033](../decisions/0033-assess-catalog-understand-selection.md) defines the `assess` item catalog and selected-unit `understand` stages; its layout statements are superseded by [ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md) and [ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md).
