# Specification profiles

> The sections an AS-IS specification has for each item kind: the file format, where a profile comes from, the built-in profiles, and what the `understand` stage does with them ([ADR-0060](../decisions/0060-item-kinds-and-kind-aware-understanding.md)).

An AS-IS specification (`10-applications/<app>/01-legacy/<module>/<unit>/spec.md`) always has the base sections of [ADR-0031](../decisions/0031-understand-stage-as-is-specification.md). A **specification profile** adds the sections that matter for one [item kind](document-repo-item-catalog.md#item-kinds): what it takes to recreate a screen, to build a client for an API, to rerun a batch job. A kind without a profile (`module`, or a kind a project invented) is specified with the base sections.

## A profile file

A profile is a Markdown file named `<kind>.md`:

```markdown
---
kind: "screen"
version: 1
---
# Specification profile: screen

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Layout and fields | a table of the fields: name, type and length, source, editable | the UI definition and the handler |

## Instructions

How the analyst writes these sections.
```

| Part | Rule |
|---|---|
| `kind` | Equal to the file name; a kebab-case name of a kind in `unitKinds` |
| `version` | A positive integer; raise it on a change that affects specifications already written |
| `## Sections` | A table with the columns `Section`, `What it holds`, `Evidence`; at most 20 rows; section names are unique. Each row is a `##` heading of the specification, in this order |
| `## Instructions` | Optional text for the analyst, read with the brief (at most 4,000 characters are used) |

A profile that does not meet these rules is not used: a project file that fails is reported by `scope_items.py` and the built-in profile of the kind (if any) applies.

## Where a profile comes from

1. The project's `01-standards/specifications/<kind>.md`, a document written by people through pull requests.
2. The built-in profile of the `reverse_engineering` plugin, `skills/understand-planning/references/spec-profiles/<kind>.md`.

The first usable one **replaces** the second as a whole file. Profiles are never merged, so a reader sees the whole contract in one file.

## The built-in profiles

| Kind | Sections added |
|---|---|
| `screen` | Layout and fields, Validations, Events and actions, Navigation, Services called, Authorization, Messages |
| `api` | Contract, Request and response, Status and error codes, Authentication and authorization, Side effects, Transactions and idempotency, Known callers |
| `batch-job` | Trigger and schedule, Inputs and outputs, Steps, Restart and recovery, Volumes and windows, Predecessors and successors |
| `report` | Parameters and selection, Data sources, Layout, Calculations, Output format and destination, Frequency and audience |
| `event` | Source, Message layout, Handling and ordering, Retries and poison messages, Side effects |
| `integration` | Counterparty, Direction, protocol and format, Field mapping, Schedule and volumes, Error handling and reconciliation, Security |
| `module` | none |

Data is not an item kind: the profiles refer to data objects by their ids in the item's `data-objects.md`.

## What the stage does with a profile

- `scope_items.py` resolves the profile of each selected item's kind and puts it, with its version and where it came from (`builtin` or `project`), in the item's brief (`profile`, `null` when the kind has none). The stage plan lists `01-standards/specifications/` among the documents it reads.
- The `legacy-analyst` job writes the profile's sections between **Main flows** and **Dependencies**, each as a `## <section name>` heading in the order given. A section with nothing to say reads "None." with the reason.
- `finish_items.py` checks the specification for the profile's headings (case, numbering and spacing do not matter). The item's `understanding.md` records `profile: <kind>@<version>` and, when a section is absent, `profileMissing` with their names; the run prints each as a `specification check` line. The item is still understood: a missing section is a finding for the reviewer of the pull request.

When a profile is raised, the items written with an older version of it become **stale** (`staleReason: profile` in the catalog, the status tooltip in the portal), and so does an item whose kind changed since. The current version is the project's `01-standards/specifications/<kind>.md` when it is a usable profile, else the built-in one. An item whose record has no `profile` is not stale for this reason, so specifications written before profiles existed stay understood until they are rerun.
