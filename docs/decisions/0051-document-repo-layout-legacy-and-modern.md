# ADR-0051: A numbered document repo layout, each application split into legacy and modern

- Status: Accepted (supersedes the tree of 0042; amends 0038, 0044, 0045, 0050; the files of the legacy half are cited `<repository id>/<path>` since 0052)
- Date: 2026-10-21
- Decision register: D67

## Context

The layout of [ADR-0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) and [ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md) is correct for the code but hard for a person to find their way in:

- Seven root folders (`program/`, `portfolio/`, `architecture/`, `standards/`, `plugins/`, `gates/`, `applications/`) in no reading order.
- Gate records at three levels (`gates/`, `applications/<app>/gates/`, a unit's `reviews/G4.md`), all placeholders: no code reads or writes them, while the governance module already records every gate decision with its history and audit in Postgres. Two places hold one decision.
- Inside an application, the application's design is split between `to-be/design.md` and `design/<set>/`; `understanding/` holds one file (`plan.md`); the assessment, the understanding and the design of a unit are spread across `assessment/`, `units/<module>/<unit>/understanding/` and `units/<module>/<unit>/design/`.
- A reader asks two questions, "what does the old system do?" and "what are we building?", and the layout answers neither at a glance: a unit's AS-IS evidence and its target design sit side by side in one folder.
- Nothing has a glossary, which a multilingual (Japanese, English, Vietnamese) project needs first.

No project runs Kintsugi yet, so nothing needs to be kept for compatibility.

## Decision

**1. Root folders carry a two-digit prefix in reading order.** Folder names are lowercase kebab-case: no capitals, spaces or `&`, because paths travel through URLs, shells, Python and Git on case-insensitive file systems. A human-language title belongs in a README or front matter, not in a folder name.

```text
README.md                         map of the repo
kintsugi.yaml                     project manifest
00-project/                       charter.md, raci.md, ai-strategy.md, ai-usage-policy.md, kpi-baseline.md,
                                  glossary.md, traceability.md (planned, generated), portfolio/ (scorecard.md, wave-plan.md)
01-standards/                     conventions/, mappings/, review-rules.md, templates/<set>/ (the design sets)
02-architecture/                  blueprint.md, poc-plan.md, adr/, common/<COM-id>.md
03-transition/                    coexistence.md, data-migration.md, shared-data/ (master data, shared formats)
10-applications/<app>/
  README.md                       the application's overview
  00-inputs/                      INTENT.md, graph/, telemetry/
  01-legacy/                      the old system: what it is and what it does
  02-modern/                      the new system: what we build
  _generated/                     read models rebuilt after a merge, and the Overview run's documents
plugins/                          project-authored member plugins
```

`scratch/<app>/` stays outside the layout, in the job workspace, never committed (ADR-0042 decision 2).

**2. `01-legacy/` is the reverse-engineering half.** Application level: `inventory.md`, `topology.md`, `assessment.md` (the synthesis, was `ASSESSMENT.md`) and `architecture.mmd` (its domain diagram, was `ARCHITECTURE.mmd`), `plan.md` (the understanding plan), `_catalog/` (`index.md`, `<module>.md`), `_tools/` (`extract_topology.py`) and `_analysis/` (the notes of the analysis jobs, scratch of the run). Per unit, `01-legacy/<module>/<unit>/`: `spec.md` (the AS-IS specification, was `as-is.md`), `understanding.md`, `rules.md` and `rules/<rule id>.md`, `rules-review.md`, `data-objects.md`, `findings.md`, `topology.md`, `trace.md`.

**3. `02-modern/` is the development half.** Application level: `requirements.md`, `design.md` (the application's own design, written with the common design, ADR-0044) and `_design/<set>/` (the design sets of scope `application`, ADR-0050). Per unit, `02-modern/<module>/<unit>/`: `README.md`, one folder per design set (`<set>/`), and `task.md`. Module notes stay beside the module's units (`02-modern/<module>/TRANSFORMATION_NOTES.md`). `to-be/` is removed: its two documents sit at the top of the modern half.

Both halves use the same `<module>/<unit>` path, so a unit's two halves sit on the same line of both trees.

**4. The unit card is `02-modern/<module>/<unit>/README.md`** (was `unit.md`). Its front matter is unchanged except that the `gates` block is removed. A Git host renders a folder's `README.md` when a person opens the folder, so the unit's card (kind, source → target, wave, status, waived design files) is the first thing they see. It sits on the modern side because most of its fields (`target`, `wave`, `assignee`, `harness`, `waived`, `taskPack`) are about the new system.

**5. Underscore marks what is not a module.** Module and unit segments match `^[a-z0-9][a-z0-9-]{0,62}$`, so a folder that starts with `_` (`_catalog/`, `_tools/`, `_design/`, `_generated/`) can never collide with a module of the same name.

**6. No gate records in the document repo.** `gates/`, `applications/<app>/gates/` and a unit's `reviews/` are removed. Gate decisions live in the governance module (portal → Governance → Gates); a generated, read-only `_generated/gate-log.md` for projects that need approval records in the repo is planned.

**7. Design set templates move to `01-standards/templates/<set>/`** (was `standards/design/<set>/`); the starter ships four sets: `basic` (functional design), `detail` (technical design), `api` (API specification, written in Markdown) and `test` (test cases).

**8. Auto-commit defaults** become:

```text
10-applications/*/02-modern/**/README.md
10-applications/*/02-modern/**/task.md
10-applications/*/01-legacy/plan.md
10-applications/*/_generated/**
```

**9. Paths.** `packages/domain/src/document-layout.ts` stays the sole owner of path construction, mirrored by each plugin's `scripts/paths.py` and the reader's `layout.ts`. No old path is read, converted or kept: there is no fallback to `applications/`, `unit.md`, `as-is.md` or `standards/design/`.

## Consequences

- A person opens `10-applications/<app>/01-legacy/` to learn the old system and `02-modern/` to follow the new one; opening a unit's modern folder shows its card.
- A unit that is understood but not yet designed has a modern folder with its `README.md` only; the card exists from the moment the unit is selected.
- The governance module is the only record of a gate decision; the gate-log rendering is follow-up work.
- `00-project/glossary.md` is a starter table (term per language, definition); `00-project/traceability.md` is planned and not generated yet.
- Every path helper, script, reader, API builder, portal label, test, template and reference page changes in one step. A document repo seeded from the old starter must be recreated and its `assess` and `understand` runs repeated.

## Alternatives considered

- **Legacy and modern at the root, applications under each.** Matches a phase-ordered deliverable list, but an application, its wave and its G1/G2 decisions would live in two trees; rejected for application first, halves second.
- **Hide the unit state in `.kintsugi/units/`.** The design job reads `kind` and the person-authored `waived` list from it and its `source → target` is the traceability link people read; rejected.
- **`index.md` for the unit card.** Only site generators render it as the folder page, and a capitalised `Index.md` breaks on case-insensitive file systems; `README.md` is rendered by every Git host.
- **OpenAPI files for API specifications.** YAML would break the Markdown-only rule of ADR-0042; an API specification is a project design set written in Markdown, and the OpenAPI file is generated from the target code.
