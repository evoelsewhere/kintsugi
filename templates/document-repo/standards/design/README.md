# `standards/design/`

- Written by: people (the foundation team and the architects), through review pull requests
- Serves: P2-P4; the format of the design documents of every unit
- Auto-commit: no — changes arrive as pull requests

The project's **design sets**: what each design document of a unit contains, in the format this project wants. A set is a folder:

```text
standards/design/<set>/
  set.md          the set: its identity (front matter) and the documents it holds (a table)
  <template>.md   one template per document
```

The starter has two sets for every unit kind: `basic` (what the unit is, written for every unit in scope) and `detail` (how it is built, written just before the unit is coded). Replace them with the sets your project needs; a project may have one set, or four (`basic`, `detail`, `db`, `report`).

## `set.md`

```markdown
---
id: detail                 # the folder name: lowercase letters, digits, hyphens
title: Detail design
version: 1                 # raise it when a change affects the designs already written
appliesTo: ["module"]      # unit kinds (from `unitKinds` in kintsugi.yaml); [] means every kind
needs: ["basic"]           # sets that must be written first
stage: detail-design       # the pipeline stage that produces it (optional)
---
A description for people: when the set is written and by whom.

| Path | Template | Required | When |
| --- | --- | --- | --- |
| logic.md | logic.md | yes | |
| data-access.md | data-access.md | no | |
```

`Path` is the document under the unit's `design/<set>/`; `Template` is a file of this folder; `When` lists the unit kinds that need the file (empty: every kind the set applies to).

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

## Working with the sets

- A member writes a unit's documents with `/kintsugi:modernize-design <app> <module/unit> <set>`: `scaffold_design.py` creates them, `check_design.py` checks them.
- A pull request that changes this folder is checked with `python3 scripts/validate_design_templates.py`.
- Each design records `template: <set>@<version>` in its front matter; when a set's version rises, the designs written against the older one show as stale in the portal.
- A unit may waive a required file: `waived: ["<set>/<file>: <reason>"]` in its `unit.md`, written by a person.

The reference is `docs/reference/design-templates.md`; the guide to define your own is `docs/guides/define-design-templates.md`.
