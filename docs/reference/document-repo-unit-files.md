# Unit files

> Defines the unit directory and the contract of each file in it.

One directory per unit ([ADR-0038](../decisions/0038-document-repo-layout-by-subject-and-sdlc-phase.md)), at `applications/<app>/units/<module>/<unit>/`; it is the **Unit aggregate** of [ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md): `unit.md` is its root and each context writes into its own subfolder (`understanding/` and `design/`). Every document is Markdown ([document formats](document-formats.md)). The unit id is the full `<app>/<module>/<unit>`; `<unit>` in the path is only the last segment. A unit is created when a catalog item (`<module>/<item>`, see the [item catalog](document-repo-item-catalog.md)) is selected for migration. This reference uses **unit** and does not rename the legacy API `WorkItem`/`work-items` contracts.

| File | Content | Written by |
|---|---|---|
| `unit.md` | the unit state (frontmatter) and gate references | the `understand` job proposes it; state changes go through the Kintsugi API; auto-committed |
| `understanding/as-is.md` | the P1 AS-IS specification of the unit | the `understand` job |
| `understanding/understanding.md` | the provenance record: digest, source commit, run (`status: understood`) | the `understand` job |
| `understanding/rules.md` | the index of the unit's rules: id, name, category, priority, confidence, version, status, source and a link to each rule's file | the extract-rules step of `understand` |
| `understanding/rules/<rule id>.md` | one rule: specification, evidence, edge cases, open questions, acceptance scenarios, version history | the extract-rules step of `understand` |
| `understanding/data-objects.md` | the data objects of the unit | the extract-rules step of `understand` |
| `understanding/rules-review.md` | the P1 human rule verdicts (a table) | the unit's reviewer, through a pull request |
| `understanding/findings.md` | security findings: scorecard, table, a card per finding | the security step of `understand` |
| `understanding/topology.md` | the unit's leaves, links to other items, data stores | the scope step of `understand` |
| `understanding/trace.md` | the unit traceability record | the `understand` job |
| `design/<set>/<file>` | the unit's design: one folder per design set the project defines, one document per file of the set, from the set's template ([design templates](design-templates.md)) | the member's harness with `/kintsugi:modernize-design`, through a pull request |
| `task.md` | the P4 task pack (transformation notes) | the `design` job; auto-committed |
| `reviews/G4.md` | the unit's G4 gate record | the unit's reviewer, through a pull request |

Format samples for `unit.md`, `rules.md`, `rules/<rule id>.md`, `rules-review.md`, `trace.md` and `reviews/G4.md` live in `templates/document-repo/applications/billing-web/units/_example.example/`; they teach the formats and are not loaded.

## `unit.md` frontmatter

The frontmatter is the unit's state ([ADR-0012](../decisions/0012-work-items-as-files-in-git.md)). Postgres indexes it for the board and queries, and can rebuild the index from Git.

| Field | Description |
|---|---|
| `id` | `<app>/<module>/<unit>`, stable |
| `application`, `module`, `kind`, `title` | Identity; `kind` is one of the `unitKinds` in `kintsugi.yaml` |
| `wave`, `pilot`, `complexity` | Planning |
| `phase`, `stage`, `status` | Progress. `status`: `pending`, `in-progress`, `awaiting-review`, `approved`, `rejected`, `blocked`, `done`, `skipped` |
| `assignee`, `harness` | Who works on it, and with which member harness |
| `dependsOn` | Unit ids (used for leaves-first ordering) |
| `source`, `target` | `{repo, paths}` lists in the legacy (read-only) and target repos |
| `links` | Task pack, AS-IS doc, mappings (paths under `standards/mappings/`), business rules, pull requests |
| `gates` | Per-gate result: `status`, `by`, `at`, and the record path (`review: reviews/G4.md`) |
| `waived` | Design files the unit does not need, a list of `<set>/<file>: <reason>`; written by a person, never by an agent ([design templates](design-templates.md#conformance)) |

**Proposed by the `understand` stage** ([ADR-0031](../decisions/0031-understand-stage-as-is-specification.md)): one file per unit the stage derives from the application's topology and catalog, with `phase: discover-assess`, `stage: understand`, `status: pending`, `complexity` from size, `dependsOn` from the traceability matrix, the legacy `source` paths and `links.asIs` / `links.businessRules`. They arrive in the stage's pull request, not as auto-commits; a unit that already has a file is left unchanged.

**Rules**:
- **Write path**: state changes go through the Kintsugi API (portal, CLI, MCP, runtime agents). The API validates the actor's effective access-role permissions and the allowed transition, updates the index, and the worker commits as `kintsugi-bot` with `Kintsugi-Actor`. `unit.md` and `task.md` are auto-commit paths; every other file in the unit directory arrives as a pull request.
- **Direct edits** are allowed only through PRs. They are validated on sync; invalid changes are flagged and not indexed.
- **History** is Git history; there is no separate transition log.

## `rules.md`, `rules/<rule id>.md` and `rules-review.md`

`rules.md` is the **index** of the unit's rules and `rules/<rule id>.md` holds each rule ([ADR-0046](../decisions/0046-one-file-per-business-rule.md)); both are machine output and the extraction source of truth. The index is a table (`ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file`) plus a table of retired rules; the rule file has front matter and the sections of the rule (summary, Given/When/Then, and, where the analysis has evidence, decision table, parameters, inputs and outputs, evidence, edge cases, open questions, acceptance scenarios) and its version history. Rule ids are deterministic and citation-derived — each rule carries the source citation it was derived from — so they stay stable across re-extractions. A rule keeps its version while its content (`digest`) is unchanged, gets the next version when it changes, and becomes a `retired` file when a later extraction no longer finds it. Human rule verdicts live separately in `rules-review.md`, a table keyed by rule id:

```markdown
| Rule | Verdict | Approver | Date |
| --- | --- | --- | --- |
| RULE-invoice.amount-1a2b3c4d | confirmed | dana | 2026-10-15 |
```

A verdict is `confirmed`, `refuted` or `clarify`, with the approver and the date (a `Note` column is optional). A verdict whose rule id is absent from the current extraction is reported as orphaned, not silently applied.

## `trace.md`

The unit traceability record has the sections `Entry points`, `Rules applied`, `Findings`, `Dependencies` (a table `Target \| Kind \| Direction`), `Data objects`, `External systems`, `Files` and the front matter `openQuestions`, plus three sections the later phases fill in:

| Section | Content |
|---|---|
| `Requirements` | the `REQ-…` ids of the requirements this unit implements |
| `Pull requests` | the pull requests that migrated the unit (e.g. `#42`) |
| `Tests` | the paths of the unit's test files in the target repository |

The chain rules → requirements → trace must close: every requirement's `derivedFrom` rules are traced rules of the unit, and every requirement derived from a traced rule is listed under `Requirements`.

## Requirements and `derivedFrom`

The requirements record is `applications/<app>/to-be/requirements.md` (planned, P2). Each requirement is a Markdown section headed `REQ-…`; the source rules are named on its `derivedFrom` line:

```markdown
## REQ-INV-001: Invoice search returns gross amounts

The invoice search returns amounts including tax.

**derivedFrom:** RULE-invoice-amount-001
```

A unit's `trace.md` links the requirement ids it implements under `Requirements`.

## Gate records

The unit's G4 record is `reviews/G4.md`, with the uniform [gate record format](document-repo.md#gate-records): decision, approvers, evidence paths, date. The `unit.md` frontmatter points to it through its `gates.G4.review` field. Gate records arrive through pull requests and are never auto-committed.
