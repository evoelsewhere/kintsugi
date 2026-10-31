# Define a project's design templates

> How to describe the design documents your project wants, so the runtime generates them, the checks verify them and the portal shows them. Reference: [Design templates](../reference/design-templates.md). Decisions: [ADR-0044](../decisions/0044-design-phase-common-basic-detail.md), [ADR-0045](../decisions/0045-design-templates-are-project-data.md).

Who: the architects and the foundation team, with the customer's format at hand. When: in P2, before the basic design of the first unit; refine it in the P3 pilot. Everything is Markdown in the project's document repo and changes by pull request.

## 1. Decide the sets

A **design set** is a group of documents written together for a unit. Start from the way the project's design work is divided:

| Question | Typical answer |
|---|---|
| How many levels of design are there, and which unit kinds does each cover? | one design set per unit kind (screen, api, batch job, report), plus a test set for every kind |
| Which one needs which? | a test set needs nothing; a set may need another whose ids it cites |
| Who reviews each? | an analyst reviews the screen and report designs, a developer the others |
| Which pipeline stage produces each? | one stage per set, or one `design` stage that produces several |

The starter declares the core unit kinds in `unitKinds` (`screen`, `api`, `batch-job`, `report`, `event`, `integration`, `module`; [ADR-0060](../decisions/0060-item-kinds-and-kind-aware-understanding.md)), the same list the portal renders for a project that declares none. Its `01-standards/templates/` has a set for `screen`, `api`, `batch-job` and `report`, each with the documents that kind needs (an overview, then what is specific to the kind: layout and events for a screen, operations and security for an API, schedule and steps for a batch job, parameters and layout for a report), and a `test` set for every kind; `event`, `integration` and `module` units get the `test` set until you add one for them. Data is not a unit kind: a table is a data object of the units that use it, and its mapping goes in `01-standards/mappings/`. A profile folder named after a kind that `unitKinds` does not declare is a template problem, so declare a kind of your own before you add its profile. Copy and change it, or add sets: a new folder with a `set.md` and its templates, merged by pull request, appears on the Design page with its own Generate button.

Units of different kinds usually need different documents and different sections. There are two ways to say so with a **profile** (step 2b). Give one set a profile per kind when the kinds share most of their documents: one set, one Generate button, a base that every kind has. Or make a set per kind with one profile named after it, as the starter does: the set has no files table, so it applies only to units of that kind, and each kind's design is versioned, reviewed and generated on its own.

Some designs belong to the whole application, not to a unit (an architecture overview, an interface list). Give such a set `scope: application` in its `set.md`: it is written once under `10-applications/<app>/02-modern/_design/<set>/`, generated for the application, and a unit set can `need` it, so a detail design can point to its identifiers. Use `reads:` to name documents the designer should also read, and a `## Instructions` section for what is specific to that kind of design (see the [reference](../reference/design-templates.md)).

## 2. Write `set.md`

Give it an id (the folder name), a title, a version (start at 1), the sets it needs and the stage that produces it. List in the table the documents every kind has: a path, the template file and whether it is required. See the [reference](../reference/design-templates.md#setmd).

## 2b. Add a profile for the kinds that differ

For each unit kind (a value of `unitKinds` in `kintsugi.yaml`) whose design differs, add a folder named after it next to `set.md`:

- `profile.md` with `kind`, `version` and, if the kind lacks some base files, `removes: ["data-access.md"]`; a table of the files it adds; and a `## Instructions` section for what is specific to that kind.
- A template of the same name as a base one (for example `logic.md`) when the kind needs different sections: it replaces the base **as a whole file**, so copy the base and change it.
- `_examples/logic.md`: a finished document of a real unit, so the designer sees the depth you expect. It is read, not checked.

A kind without a folder gets the base files and templates. A set with no files table is only for the kinds that have a profile. Raise the `version` in `profile.md` when you change that kind's templates in a way that affects designs already written: only that kind's designs become stale.

## 3. Write a template per document

Start from the document the customer expects, in Markdown. Keep its headings. Under each heading that has a contract, add the directive comment:

- `required` for what must always be written;
- `table:` with the columns when the section is a table;
- `check:` for what a script can verify: `no-placeholder` almost everywhere, `covers-rules(Column)` where every business rule must appear, `refs-resolve(Column -> source)` where ids point to rules, requirements, common components or an earlier set, `id-pattern` for ids of a fixed shape, `one-of` for a fixed vocabulary, `max-length` to keep a summary short;
- `guidance:` in one or two sentences: what a good section says. The agent that writes the section reads it as its instruction.

Put ids where you want traceability. A column named `ID` in a table makes its cells **design items** that a later set can point to (`refs-resolve(Function -> basic)`); a common component is a file `02-architecture/common/COM-<AREA>-<NN>.md`.

## 4. Validate

```bash
python3 scripts/validate_design_templates.py
```

Run it in the document repo checkout, and on every pull request that changes `01-standards/templates/`. It lists each fault with its path.

## 5. Pilot it

Take one or two units through the whole flow on the Design page of the portal: generate the set for them, and look at the pull request: the scaffold wrote the drafts, the designer filled them from your guidance, `check_design.py` verified them. Where the generated design is poor, the check is too strict or too loose, change the template, not the designs:

| Symptom | Change |
|---|---|
| Generated or corrected sections keep coming out in a different shape | the `table:` columns or the heading are wrong for the work, or the `guidance:` does not say what it should |
| A check fails on correct content | loosen the `id-pattern` or the options |
| Nothing fails on a poor document | add `required`, `covers-rules` or `refs-resolve` where it matters |

When a change affects designs already written, raise `version` in `set.md` (or in the kind's `profile.md` for a change to its templates): the designs written against the older version show as **stale** in the portal, and the team decides whether to bring them up to date.

## If the customer has its own format

Customers often supply a spreadsheet or a document as the format. Convert it once, as part of the project build: give a harness the sample and the [reference](../reference/design-templates.md), ask for the `set.md` and the templates, then review them as you would any standard and run the validator. The result is Markdown, because the repo holds Markdown only; an export to the customer's format is a separate, later step.

## A unit that does not need a file

A unit may leave out a required file when it does not apply (a screen with no data access). A person records it in the front matter of the unit's card, `10-applications/<app>/02-modern/<module>/<unit>/README.md`:

```markdown
waived:
  - "detail/data-access.md: the unit reads no data store"
```

The checks accept it and the review shows the reason. An agent never adds a waiver.
