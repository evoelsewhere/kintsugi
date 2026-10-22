# Define a project's design templates

> How to describe the design documents your project wants, so the runtime generates them, the checks verify them and the portal shows them. Reference: [Design templates](../reference/design-templates.md). Decisions: [ADR-0044](../decisions/0044-design-phase-common-basic-detail.md), [ADR-0045](../decisions/0045-design-templates-are-project-data.md).

Who: the architects and the foundation team, with the customer's format at hand. When: in P2, before the basic design of the first unit; refine it in the P3 pilot. Everything is Markdown in the project's document repo and changes by pull request.

## 1. Decide the sets

A **design set** is a group of documents written together for a unit. Start from the way the project's design work is divided:

| Question | Typical answer |
|---|---|
| How many levels of design are there, and which unit kinds does each cover? | basic design for every kind; detail design per kind |
| Which one needs which? | detail needs basic |
| Who reviews each? | an analyst reviews the basic design, a developer the detail design |
| Which pipeline stage produces each? | `basic-design`, `detail-design` |

The starter in `01-standards/templates/` has `basic` and `detail` for every unit kind. Copy and change it, or add sets (`db`, `screen`, `report`): a new folder with a `set.md` and its templates, merged by pull request, appears on the Design page with its own Generate button.

Some designs belong to the whole application, not to a unit (an architecture overview, an interface list). Give such a set `scope: application` in its `set.md`: it is written once under `10-applications/<app>/02-modern/_design/<set>/`, generated for the application, and a unit set can `need` it, so a detail design can point to its identifiers. Use `reads:` to name documents the designer should also read, and a `## Instructions` section for what is specific to that kind of design (see the [reference](../reference/design-templates.md)).

## 2. Write `set.md`

Give it an id (the folder name), a title, a version (start at 1), the unit kinds it applies to, the sets it needs and the stage that produces it. List the documents in the table: a path, the template file, whether it is required, and the kinds that need it. See the [reference](../reference/design-templates.md#setmd).

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

When a change affects designs already written, raise `version` in `set.md`: the designs written against the older version show as **stale** in the portal, and the team decides whether to bring them up to date.

## If the customer has its own format

Customers often supply a spreadsheet or a document as the format. Convert it once, as part of the project build: give a harness the sample and the [reference](../reference/design-templates.md), ask for the `set.md` and the templates, then review them as you would any standard and run the validator. The result is Markdown, because the repo holds Markdown only; an export to the customer's format is a separate, later step.

## A unit that does not need a file

A unit may leave out a required file when it does not apply (a screen with no data access). A person records it in the front matter of the unit's card, `10-applications/<app>/02-modern/<module>/<unit>/README.md`:

```markdown
waived:
  - "detail/data-access.md: the unit reads no data store"
```

The checks accept it and the review shows the reason. An agent never adds a waiver.
