# Document repository

One repository holds everything Kintsugi and the project's people write about a migration:
program framing, portfolio decisions, standards, architecture, and per application the old system
as it is understood and the new system as it is designed. This folder is the Kintsugi starter
template; `scripts/e2e/start.mjs` seeds it into the end-to-end environment's document repository.

## Layout

The folders are numbered in reading order (ADR-0051):

```text
kintsugi.yaml                  project manifest (repositories, unit kinds, pipelines, policy)
00-project/                    P0-P1: charter, RACI, AI strategy and usage policy, KPI baseline, glossary, portfolio/
01-standards/                  P2-P3: conventions/, mappings/, review-rules.md, templates/ (the design sets)
02-architecture/               P2: blueprint, PoC plan, adr/, common/ (the common components)
03-transition/                 P2-P4: coexistence, data migration, shared-data/ (master data and shared formats)
10-applications/<app>/
  README.md                    the application's overview
  00-inputs/                   INTENT.md and the graphs and telemetry people attach
  01-legacy/                   the old system (P1): the assessment, the catalog, the understanding plan
    <module>/<unit>/           what is known about a unit
  02-modern/                   the new system (P2-P4): requirements.md, design.md, _design/<set>/
    <module>/<unit>/           the unit's card, its design and its task pack
  _generated/                  read models rebuilt after a merge
plugins/                       P3: project-authored plugins only
```

Every committed document is Markdown (front matter, tables, cards). A unit is the thing being
migrated; both halves of its application use the same `<module>/<unit>` path:

```text
10-applications/<app>/01-legacy/<module>/<unit>/
  spec.md                      AS-IS specification
  understanding.md             provenance: digest, commit, run (marks the unit understood)
  rules.md rules/ data-objects.md   machine rule extraction (an index and a file per rule)
  rules-review.md              human rule verdicts (a table)
  findings.md topology.md trace.md

10-applications/<app>/02-modern/<module>/<unit>/
  README.md                    the unit's card: identity, kind, source → target, wave, state, waived design files
  <set>/                       the unit's documents of one design set (basic/, detail/, api/, test/, ...)
  task.md                      the task pack a member implements from
```

The unit id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is the last segment.
An entry in `01-legacy/_catalog/` is a catalog **item** (`<module>/<item>`); once selected for
migration it becomes a **unit**. A folder whose name starts with `_` belongs to the application,
never to a module.

## Folder READMEs

Every folder carries a README.md that names who writes it, which phase it serves, and whether it
is auto-committed. Writers are people (including review pull requests), the Kintsugi runtime jobs,
member harnesses, or Kintsugi itself.

## Gates

Gate decisions (G0-G4 and the stage gates) are requested, approved and audited in the portal
(Governance → Gates). The repository holds no gate records.

## Auto-commit

By default Kintsugi commits straight to the default branch only:

```text
10-applications/*/02-modern/*/*/README.md
10-applications/*/02-modern/*/*/task.md
10-applications/*/_generated/**
10-applications/*/01-legacy/plan.md
```

`kintsugi.yaml` can replace the list with its `autoCommitPaths` key. Everything else arrives as
a pull request from a `kintsugi/<user>/<write-id>` branch.

## Format samples

Files and folders whose name contains `.example` (the unit samples under
`10-applications/<app>/01-legacy/_example.example/` and `02-modern/_example.example/`, the standards
samples, the plugin sample) teach a file format. They are not loaded and are not seeded into a
project's document repository; copy them to a real name and adapt the content.
