# Unit files

> Defines the two folders of a unit and the contract of each file in them.

A unit has one folder in each half of its application, on the same `<module>/<unit>` path ([ADR-0051](../decisions/0051-document-repo-layout-legacy-and-modern.md)): `10-applications/<app>/01-legacy/<module>/<unit>/` holds what is known about it, `10-applications/<app>/02-modern/<module>/<unit>/` holds its card, its design and its task pack. Together they are the **Unit aggregate** of [ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md), and the card `README.md` is its root. Every document is Markdown ([document formats](document-formats.md)). The unit id is the full `<app>/<module>/<unit>`; `<unit>` in the path is only the last segment. A unit is created when a catalog item (`<module>/<item>`, see the [item catalog](document-repo-item-catalog.md)) is selected for migration. This reference uses **unit** and does not rename the legacy API `WorkItem`/`work-items` contracts.

In `01-legacy/<module>/<unit>/`:

| File | Content | Written by |
|---|---|---|
| `spec.md` | the P1 AS-IS specification of the unit | the `understand` job |
| `understanding.md` | the provenance record: digest, source commit, run (`status: understood`) | the `understand` job |
| `rules.md` | the index of the unit's rules: id, name, category, priority, confidence, version, status, source and a link to each rule's file | the extract-rules step of `understand` |
| `rules/<rule id>.md` | one rule: specification, evidence, edge cases, open questions, acceptance scenarios, version history | the extract-rules step of `understand` |
| `data-objects.md` | the data objects of the unit | the extract-rules step of `understand` |
| `rules-review.md` | the P1 human rule verdicts (a table) | the unit's reviewer, through a pull request |
| `findings.md` | security findings: scorecard, table, a card per finding | the security step of `understand` |
| `topology.md` | the unit's leaves, links to other items, data stores | the scope step of `understand` |
| `trace.md` | the unit traceability record | the `understand` job |

In `02-modern/<module>/<unit>/`:

| File | Content | Written by |
|---|---|---|
| `README.md` | the unit's card: its state (frontmatter), what it is built from and into, the design files it waives | the `understand` job proposes it; state changes go through the Kintsugi API; auto-committed; `waived` is written by a person |
| `<set>/<file>` | the unit's design: one folder per design set the project defines, one document per file of the set, from the set's template ([design templates](design-templates.md)) | the runtime `design` stage (generated from the portal), through a pull request that people review and correct |
| `task.md` | the P4 task pack (transformation notes) | planned; auto-committed |

A Git host renders a folder's `README.md` when a person opens the folder, so opening a unit's modern folder shows its card. Format samples for the card, `rules.md`, `rules/<rule id>.md`, `rules-review.md` and `trace.md` live in `templates/document-repo/10-applications/billing-web/01-legacy/_example.example/` and `02-modern/_example.example/`; they teach the formats and are not loaded.

## The card's frontmatter

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
| `requiredDeliverables` | Optional bounded {id, repositoryId, path} declarations; stable IDs flow into briefs, snapshots and gate evidence |
| `links` | Task pack, AS-IS specification, mappings (paths under `01-standards/mappings/`), business rules, pull requests |
| `waived` | Design files the unit does not need, a list of `<set>/<file>: <reason>`; written by a person, never by an agent ([design templates](design-templates.md#conformance)) |

Gate results are not in the card: gate decisions are recorded in the portal (Governance → Gates).

**Proposed by the `understand` stage** ([ADR-0031](../decisions/0031-understand-stage-as-is-specification.md)): one card per unit the stage derives from the application's topology and catalog, with `phase: discover-assess`, `stage: understand`, `status: pending`, `complexity` from size, `dependsOn` from the traceability matrix, the legacy `source` paths and `links.asIs` / `links.businessRules`. They arrive in the stage's pull request, not as auto-commits; a unit that already has a card is left unchanged.

**Rules**:
- **Write path**: state changes go through authorized portal or administrative API actions. The API validates the actor's effective permissions and allowed transition, updates the index, and the worker commits as the Kintsugi bot with a Kintsugi actor trailer. The Coding Agent Workflow CLI and MCP are read-only. The card and task pack are auto-commit paths; other unit documents arrive through reviewed pull requests.
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

The requirements record is `10-applications/<app>/02-modern/requirements.md` (planned, P2). Each requirement is a Markdown section headed `REQ-…`; the source rules are named on its `derivedFrom` line:

```markdown
## REQ-INV-001: Invoice search returns gross amounts

The invoice search returns amounts including tax.

**derivedFrom:** RULE-invoice-amount-001
```

A unit's `trace.md` links the requirement ids it implements under `Requirements`.
