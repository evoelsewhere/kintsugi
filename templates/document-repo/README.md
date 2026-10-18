# Document repository

One repository holds everything Kintsugi and the project's people write about a migration:
program framing, portfolio decisions, architecture, per-application evidence and units, and the
generated aggregates. This folder is the Kintsugi starter template; `scripts/e2e/start.mjs` seeds
it into the end-to-end environment's document repository.

## Layout

```text
kintsugi.yaml                  project manifest (repositories, unit kinds, pipelines, policy)
program/                       P0: charter, RACI, AI strategy, KPI baseline, AI usage policy
portfolio/                     P1: scorecard, disposition decisions, wave plan
architecture/                  P2: blueprint, coexistence, data migration plan, PoC plan, ADRs
standards/                     P2-P3: conventions/, mappings/, review-rules.md
plugins/                       P3: project-authored plugins only
gates/                         project-level gate records (G0, G3)
applications/<app>/
  inputs/                      INTENT.md and the graphs and telemetry people attach
  assessment/                  P1: assess and understand outputs (catalog, reports, extraction)
  to-be/                       P2: requirements.md, design.md
  gates/                       application gate records (G1, G2, G5, G6)
  units/<module>/<unit>/       P1-P5: one directory per unit (see below)
  cutover/                     P6: plan.md, runbook.md, rollback.md, go-no-go.md
  operate/                     P7: hypercare-report.md, handover.md
  generated/                   rebuilt application aggregates
```

A unit is the thing being migrated; its directory holds its own evidence:

```text
applications/<app>/units/<module>/<unit>/
  unit.md                      unit state and gate references
  as-is.md                     P1 AS-IS specification
  rules.json                   P1 machine rule extraction
  rules-review.json            P1 human rule verdicts
  findings.json topology.json trace.json meta.json
  task.md design.md            P4 task pack and design
  reviews/G4.md                the unit's G4 record
  verify/                      P5 golden cases, equivalence runs and test evidence
```

The unit id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is the last segment.
An entry in `assessment/catalog.json` is a catalog **item** (`<module>/<item>`); once selected for
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
(`applications/<app>/gates/G1.md`, `G2.md`, `G5.md`, `G6.md`) are placeholders here; a unit's G4
record lives under the unit's `reviews/` and `unit.md` points to it. Gate records always arrive
through pull requests and are never auto-committed.

## Auto-commit

By default Kintsugi commits straight to the default branch only:

```text
applications/*/units/**/unit.md
applications/*/units/**/task.md
applications/*/generated/**
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as
a pull request from a `kintsugi/<user>/<write-id>` branch.

## Format samples

Files and folders whose name contains `.example` (the unit samples under
`applications/<app>/units/_example.example/`, the standards samples, the plugin sample) teach a
file format. They are not loaded and are not seeded into a project's document repository; copy
them to a real name and adapt the content.
