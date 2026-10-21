# Document repository

One repository holds everything Kintsugi and the project's people write about a migration:
program framing, portfolio decisions, architecture, per-application evidence and units, and the
generated aggregates. This folder is the Kintsugi starter template; `scripts/e2e/start.mjs` seeds
it into the end-to-end environment's document repository.

## Layout

```text
kintsugi.yaml                  project manifest (repositories, unit kinds, pipelines, policy)
program/                       P0: charter, RACI, AI strategy, KPI baseline, AI usage policy
portfolio/                     P1: scorecard, wave plan
architecture/                  P2: blueprint, common/ components, coexistence, data migration plan, PoC plan, ADRs
standards/                     P2-P3: conventions/, mappings/, design/ (design sets), review-rules.md
plugins/                       P3: project-authored plugins only
gates/                         project-level gate records (G0, G3)
applications/<app>/
  inputs/                      INTENT.md and the graphs and telemetry people attach
  assessment/                  Assessment context (P1): inventory.md, topology.md, catalog/, ASSESSMENT.md
  understanding/               Understanding context: plan.md (the AI plan, advice)
  to-be/                       P2: requirements.md, design.md (this application's own design)
  gates/                       application gate records (G1, G2)
  units/<module>/<unit>/       the Unit aggregate, P1-P4: one directory per unit (see below)
  generated/                   read models rebuilt after a merge
```

Every committed document is Markdown (front matter, tables, cards). A unit is the thing being migrated; its directory is its aggregate, `unit.md` is the root, and each context writes into its own subfolder:

```text
applications/<app>/units/<module>/<unit>/
  unit.md                      unit state and gate references
  understanding/               P1: what is known about the unit
    as-is.md                   AS-IS specification
    understanding.md           provenance: digest, commit, run (marks the unit understood)
    rules.md rules/ data-objects.md   machine rule extraction (an index and a file per rule)
    rules-review.md            human rule verdicts (a table)
    findings.md topology.md trace.md
  design/<set>/                P2-P4: the unit's design documents, one folder per design set of the project
  task.md                      P4 task pack
  reviews/G4.md                the unit's G4 record
```

The unit id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is the last segment.
An entry in `assessment/catalog/` is a catalog **item** (`<module>/<item>`); once selected for
migration it becomes a **unit**. Use "unit" for the thing and "item" only for a catalog entry.

## Folder READMEs

Every folder carries a README.md that names who writes it, which phase or gate it serves, and
whether it is auto-committed. Writers are people (including review pull requests), the Kintsugi
runtime jobs, member harnesses, or Kintsugi itself.

## Gate records

Gate records are Markdown files whose body records:

```text
- Decision:            approved / rejected / pending
- Approvers:           names and roles
- Evidence:            paths in this repository supporting the decision
- Date:                YYYY-MM-DD
```

Project-level records (`gates/G0.md`, `gates/G3.md`) and application records
(`applications/<app>/gates/G1.md`, `G2.md`) are placeholders here; a unit's G4
record lives under the unit's `reviews/` and `unit.md` points to it. Gate records always arrive
through pull requests and are never auto-committed.

## Auto-commit

By default Kintsugi commits straight to the default branch only:

```text
applications/*/units/**/unit.md
applications/*/units/**/task.md
applications/*/generated/**
applications/*/understanding/plan.md
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as
a pull request from a `kintsugi/<user>/<write-id>` branch.

## Format samples

Files and folders whose name contains `.example` (the unit samples under
`applications/<app>/units/_example.example/`, the standards samples, the plugin sample) teach a
file format. They are not loaded and are not seeded into a project's document repository; copy
them to a real name and adapt the content.
