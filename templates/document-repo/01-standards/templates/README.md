# `01-standards/templates/`

- Written by: people (the foundation team and the architects), through review pull requests
- Serves: P2-P4; the format of the design documents of every unit
- Auto-commit: no — changes arrive as pull requests

The project's **design sets**: what each design document of a unit contains, in the format this project wants. A set is a folder:

```text
01-standards/templates/<set>/
  set.md          the set: its identity (front matter) and the documents it holds (a table)
  <template>.md   one template per document
  _examples/      finished documents the designer reads (optional)
  <kind>/         the profile of one unit kind (optional): see "A profile per unit kind"
```

The starter's `kintsugi.yaml` declares Kintsugi's core unit kinds in `unitKinds` (`screen`, `api`, `batch-job`, `report`, `event`, `integration`, `module`; ADR-0060), the kinds the portal renders until a project declares its own. The starter has a set for four of them, each only for units of that kind (the set has no files table; its documents come from the profile folder named after the kind), and a `test` set for every kind; an `event`, `integration` or `module` unit gets the `test` set until you add a set or a profile for its kind:

| Set | For units of kind | Documents |
| --- | --- | --- |
| `screen` | `screen` | `overview.md`, `layout.md`, `events.md`, `data.md` (optional) |
| `api` | `api` | `overview.md`, `endpoints.md`, `security.md` (optional) |
| `batch-job` | `batch-job` | `overview.md`, `schedule.md`, `steps.md`, `operations.md` (optional) |
| `report` | `report` | `overview.md`, `parameters.md`, `layout.md`, `data.md` |
| `test` | every kind | `cases.md`, `test-data.md` (optional) |

Data is not a unit kind: a table or a record layout is a data object of the units that use it (ADR-0060), and its mapping goes in `../mappings/`. A profile folder is only valid for a kind in `unitKinds`; a project that adds a kind of its own (`ledger-close`) declares it there first.

Every document carries the contract of its sections (tables, id patterns, vocabularies, checks) and guidance for the designer; `_examples/` holds a finished document of a kind. Replace them with the sets your project needs: keep a set per kind, or give one set a profile per kind (below), or define the sets by level of design (`basic`, `detail`, ...) as your customer does.

## `set.md`

```markdown
---
id: design                 # the folder name: lowercase letters, digits, hyphens
title: Detail design
version: 1                 # raise it when a change affects the designs already written
needs: ["architecture"]    # sets that must be written first
stage: design              # the pipeline stage that produces it (optional)
---
A description for people: when the set is written and by whom.

| Path | Template | Required |
| --- | --- | --- |
| logic.md | logic.md | yes |
| data-access.md | data-access.md | no |
```

`Path` is the document under the unit's `<set>/` folder (`10-applications/<app>/02-modern/<module>/<unit>/<set>/`); `Template` is a file of this folder. The files table is the base: every unit kind has these files unless its profile changes them.

## A profile per unit kind

Units of different kinds (a screen, a batch job, an integration) need different documents and different sections. A folder named after a unit kind of `unitKinds` holds the profile of that kind for this set:

```text
design/
  set.md
  logic.md                     the base template, used by every kind without its own
  screen/
    profile.md                 kind, version, files added or removed, instructions for this kind
    logic.md                   replaces the base logic.md for screens, as a whole file
    _examples/logic.md         a finished screen logic, read by the designer and never checked
  integration/
    profile.md                 removes data-access.md, adds field-mapping.md
    field-mapping.md           a document only integrations have
```

```markdown
---
kind: integration          # the folder name
version: 1                 # raise it when a change affects the designs written with this profile's templates
removes: ["data-access.md"]   # base files this kind does not have
---
| Path | Template | Required |
| --- | --- | --- |
| field-mapping.md | field-mapping.md | yes |

## Instructions
Read by the designer after the set's own.
```

The files of a set for a kind are the set's, plus the profile's table (a path the set also lists is redefined), minus `removes`. The template of a file is `<kind>/<template>.md` when it exists, else `<template>.md`: a whole file, never merged. A set with no files table is only for the kinds that have a profile (each starter set is only for units of its kind). A design names the template it was written with: `template: "design@1"`, or `template: "design/screen@1"` for a profile's, so raising the screen profile makes only the screen designs stale. A profile folder needs its kind in `unitKinds`.

## A template

A template is the document an author starts from. Under a heading, an HTML comment (not shown when rendered) holds that section's contract, one directive per line:

```markdown
## Business rule coverage
<!--
required
table: Rule | Function | Notes
seed: rules
check: covers-rules(Rule)
check: no-placeholder
guidance: Every business rule of the unit appears once; name the function that handles it.
-->
```

| Directive | Meaning |
| --- | --- |
| `required` | the section must be written and not empty |
| `table: A \| B` | the section is a table with exactly these columns |
| `seed: rules` | the scaffold fills the first column from the unit's rules |
| `check: name(args)` | a check, run after the author: see below (repeatable) |
| `guidance: text` | what to write; the agent reads it as its instruction |

Checks: `no-placeholder` (no `TODO` or `TBD` left), `covers-rules(Column)` (every rule of the unit is in the column), `refs-resolve(Column -> source)` (every id in the column exists; the source is `rules`, `requirements`, `components`, or a set this one needs), `id-pattern(Column, pattern)`, `max-length(n)`, `one-of(Column, a|b|c)`.

The scaffold fills the variables `{{unit.id}}`, `{{unit.title}}`, `{{app.id}}`, `{{kind}}`, `{{set.id}}` and `{{set.version}}`. A heading without a directive block is only structure.

## A set for the whole application

`scope: application` in `set.md` makes a set one design for the application (an architecture overview, an interface list), written under `10-applications/<app>/02-modern/_design/<set>/` and generated for the application from the Design page. It has no profiles (an application has no unit kind), and its templates use no rule seed, no `covers-rules` and no `{{unit.*}}` variable; a unit set can `need` it. `reads: ["10-applications/{app}/00-inputs/"]` names documents the designer also reads, and a section `## Instructions` in `set.md` tells it how this kind of design is written.

## Working with the sets

- A unit's documents are generated from the Design page of the portal (the `design` stage: `scaffold_design.py` creates the drafts, a designer agent fills them from the guidance, `check_design.py` checks them) and arrive in a pull request that people review and correct.
- A pull request that changes this folder is checked with `python3 scripts/validate_design_templates.py`.
- Each design records `template: <set>@<version>` (or `<set>/<kind>@<version>`) in its front matter; when a set's version rises, the designs written against the older one show as stale in the portal.
- A unit may waive a required file: `waived: ["<set>/<file>: <reason>"]` in its card (`02-modern/<module>/<unit>/README.md`), written by a person.

The reference is `docs/reference/design-templates.md`; the guide to define your own is `docs/guides/define-design-templates.md`.
