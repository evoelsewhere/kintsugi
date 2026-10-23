# Document formats

> The shapes of the Markdown documents the stages commit to the document repo. The repo holds no JSON ([ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md)).

One reader and one writer implement this page: `packages/agents/builtin/plugins/reverse_engineering/scripts/docmd.py` writes, `hooks/reader/document.ts` reads. A reader never throws on a malformed file; it drops what does not fit.

## Building blocks

| Block | Shape | Used for |
|---|---|---|
| Front matter | `---` lines at the top: `key: value`, strings quoted as JSON, numbers and booleans plain, a list as a block (`key:` then `  - "item"`). Only scalars and short lists. | Facts about the document: totals, provenance, counts |
| Table | GFM; one record per row; `\|` escapes a pipe; one line per cell | Records of one kind: catalog items, edges, verdicts, findings |
| Card | A heading `## id: title` (or `###`), prose, field bullets `- **key:** value` (a list is nested bullets), subsections one level down | A record with prose or nested fields: a catalog item, a rule, a finding detail |
| List | Bullets, paths and ids in backticks | Unbounded lists: the files of an item, the unassigned files |

Anything unbounded is a list or a table inside a section, never front matter. Ids and paths are written in backticks.

One more shape is read only by the design-set tools: a **directive comment** under a heading of a design template (`<!-- required`, `table: …`, `check: …`, `-->`), which holds that section's contract and is invisible when rendered. See [Design templates](design-templates.md).

## Documents

| Path (`10-applications/<app>/…`; a path that starts with a numbered root is from the repo root) | Written by | Content |
|---|---|---|
| `01-legacy/inventory.md` | `inventory.py` | Front matter with the figures of record (`sloc`, `ksloc`, `complexityIndex`, `sources`: the `<repository id>@<commit>` of each legacy repository measured, …); tables `Languages`, `Directories`, `Size distribution`, `Most complex files` |
| `01-legacy/topology.md` | `render_topology.py` | Front matter (`system`, counts, `truncated`); tables `Domains`, `Edges between domains`, `Leaves` (with `Entry point` and `Dead end` columns), `Edges`; `Observations`, `Flows`, a Mermaid `Diagram` |
| `01-legacy/_catalog/index.md` | `render_catalog.py` | Front matter (`app`, source commit, counts); tables `Modules` and `Items`; lists `Ambiguities` and `Unassigned files` |
| `01-legacy/_catalog/<module>.md` | `render_catalog.py` | One card per item: fields `kind`, `status`, `loc`, `complexity`, `digest`, `aliases`; subsections `Leaves`, `Depends on`, `Used by`, `Data stores`, `Parts`, `Files` |
| `01-legacy/plan.md` | `check_plan.py` | Front matter (`version`, `catalogSources`, counts); the strategy; a card `## Batch <n>: <title>` per batch (rationale, fields `risk`, `loc`, `high complexity`, `cohesion`, subsections `Items`, `Depends on outside`); tables `Left out`, `Dropped` |
| `01-legacy/<module>/<unit>/understanding.md` | `finish_items.py` | Front matter: `status: understood`, `digest`, `sources`, `runId`, `specification`, counts, and `profile: <kind>@<version>` (with `profileMissing` when the specification lacks a section of it, [specification profiles](specification-profiles.md)). Its presence on the default branch means the unit is understood |
| `…/spec.md` | the specification job | The 11 sections of the AS-IS specification; the last, `Gaps and questions`, is a table `ID \| Kind \| Question \| Where \| Impact` (ids `GAP-<module>.<unit>-NN`; kinds `missing-source`, `unresolved`, `ambiguous`, `unverified`; impact `blocking`, `risk`, `note`; [ADR-0057](../decisions/0057-evidence-marks-and-gaps.md)) |
| `…/rules.md` | `split_rules.py` | The rules index: front matter (`catalogVersion`, `rules`, `p0`); a table `ID \| Name \| Category \| Priority \| Confidence \| Version \| Status \| Source \| Rule file`; a table `Retired rules`; the explicit no-rules line when empty |
| `…/rules/<rule id>.md` | `split_rules.py` | One rule: front matter (`id`, `name`, `category`, `priority`, `confidence`, `status`, `version`, `digest`, `source`, …); sections `Summary`, `Specification` (Given/When/Then), `Decision table`, `Flow`, `Parameters`, `Inputs and outputs`, `Evidence`, `Edge cases`, `Suspected defects`, `Open questions`, `Acceptance scenarios`, `Version history` (only those with evidence), see [ADR-0046](../decisions/0046-one-file-per-business-rule.md) |
| `…/data-objects.md` | `split_rules.py` | One `## name` section per object with `Source:` and a field table |
| `…/rules-review.md` | people, in a pull request | Table `Rule \| Verdict \| Approver \| Date` (and an optional `Note`); verdicts `confirmed`, `refuted`, `clarify` |
| `…/findings.md` | `split_findings.py` | Scorecard table; table `Findings by severity`; a `### SEC-…` card per finding for the fix and the masked evidence; `Tools not run`, `Files reviewed` |
| `…/topology.md` | `scope_items.py` | The topology document of one item: its leaves, `Depends on`, `Used by`, `Data stores` |
| `…/trace.md` | `finish_items.py` | Front matter (`openQuestions`, the rows of the specification's gaps table); sections `Entry points`, `Rules applied`, `Findings`, `Dependencies` (table), `Data objects`, `External systems`, `Files`, `Requirements`, `Pull requests`, `Tests` |
| `01-standards/templates/<set>/set.md`, `<template>.md` | people | A design set: front matter (`id`, `title`, `version`, `needs`, `stage`) and a files table; templates with directive comments ([design templates](design-templates.md)) |
| `01-standards/templates/<set>/<kind>/profile.md`, `<template>.md`, `_examples/` | people | The profile of a set for a unit kind: front matter (`kind`, `version`, `removes`), a files table, templates that replace the set's and finished examples ([ADR-0053](../decisions/0053-design-template-profiles-by-unit-kind.md)) |
| `02-modern/<module>/<unit>/README.md` | `finish_items.py`, then the Kintsugi API and people | The unit's card: front matter (identity, kind, state, `source`, `target`, `links`, `waived`) and a short body ([unit files](document-repo-unit-files.md)) |
| `02-modern/<module>/<unit>/<set>/<file>` | `scaffold_design.py`, then the `design` stage's designer | A design document: front matter `template: "<set>@<version>"` (or `"<set>/<kind>@<version>"`) and `unit`, then the sections and tables the template names |
| `_generated/traceability.md` | `rebuild_aggregates.py` | Front matter with the totals the headlines read; one row per understood unit |
| `_generated/GAPS.md` | `rebuild_aggregates.py` | The units' `Gaps and questions` rows joined (`Item \| ID \| Kind \| Impact \| Question \| Where`), blocking first; front matter counts by impact and kind ([ADR-0057](../decisions/0057-evidence-marks-and-gaps.md)) |
| `_generated/BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `README.md` | `rebuild_aggregates.py` | The index of the units' rules (one row per rule with its version and a link to the rule's file), the units' objects and findings joined; the index of the specifications |

## Scratch

The data a run passes between its steps is JSON under `scratch/<app>/` in the job workspace and is never committed: `inventory.json`, `topology.json`, `catalog.json`, `catalog-draft/`, `understand/` (`scope.json`, `shards.json`, `scan.json`, `rules_result.json`, `graph.json`, `plan-draft.json`, `briefs/`, `trace/`). The plans mark it `intermediate`.

## Limits

The job-output hook refuses a file over 1 MiB, and the API serves a file up to 2 MiB; the documents above stay under both by summarising (the inventory and the topology cap their tables, the catalog index lists at most 200 unassigned files). A module whose catalog document outgrows the API limit is not shown.
