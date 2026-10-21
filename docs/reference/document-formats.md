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

| Path (`applications/<app>/…`) | Written by | Content |
|---|---|---|
| `assessment/inventory.md` | `inventory.py` | Front matter with the figures of record (`sloc`, `ksloc`, `complexityIndex`, `sourceCommit`, …); tables `Languages`, `Directories`, `Size distribution`, `Most complex files` |
| `assessment/topology.md` | `render_topology.py` | Front matter (`system`, counts, `truncated`); tables `Domains`, `Edges between domains`, `Leaves` (with `Entry point` and `Dead end` columns), `Edges`; `Observations`, `Flows`, a Mermaid `Diagram` |
| `assessment/catalog/index.md` | `render_catalog.py` | Front matter (`app`, source commit, counts); tables `Modules` and `Items`; lists `Ambiguities` and `Unassigned files` |
| `assessment/catalog/<module>.md` | `render_catalog.py` | One card per item: fields `kind`, `status`, `loc`, `complexity`, `digest`, `aliases`; subsections `Leaves`, `Depends on`, `Used by`, `Data stores`, `Parts`, `Files` |
| `understanding/plan.md` | `check_plan.py` | Front matter (`version`, `catalogCommit`, counts); the strategy; a card `## Batch <n>: <title>` per batch (rationale, fields `risk`, `loc`, `high complexity`, `cohesion`, subsections `Items`, `Depends on outside`); tables `Left out`, `Dropped` |
| `units/<module>/<unit>/understanding/understanding.md` | `finish_items.py` | Front matter: `status: understood`, `digest`, `commit`, `runId`, `specification`, counts. Its presence on the default branch means the unit is understood |
| `…/understanding/as-is.md` | the specification job | The 11 sections of the AS-IS specification |
| `…/understanding/rules.md` | `split_rules.py` | Front matter; a table of the rules; one card per rule `### RULE-<module>.<unit>-<hash>: name` grouped by category |
| `…/understanding/data-objects.md` | `split_rules.py` | One `## name` section per object with `Source:` and a field table |
| `…/understanding/rules-review.md` | people, in a pull request | Table `Rule \| Verdict \| Approver \| Date` (and an optional `Note`); verdicts `confirmed`, `refuted`, `clarify` |
| `…/understanding/findings.md` | `split_findings.py` | Scorecard table; table `Findings by severity`; a `### SEC-…` card per finding for the fix and the masked evidence; `Tools not run`, `Files reviewed` |
| `…/understanding/topology.md` | `scope_items.py` | The topology document of one item: its leaves, `Depends on`, `Used by`, `Data stores` |
| `…/understanding/trace.md` | `finish_items.py` | Front matter (`openQuestions`); sections `Entry points`, `Rules applied`, `Findings`, `Dependencies` (table), `Data objects`, `External systems`, `Files`, `Requirements`, `Pull requests`, `Tests` |
| `standards/design/<set>/set.md`, `<template>.md` | people | A design set: front matter (`id`, `title`, `version`, `appliesTo`, `needs`, `stage`) and a files table; templates with directive comments ([design templates](design-templates.md)) |
| `units/<module>/<unit>/design/<set>/<file>` | `scaffold_design.py`, then the member's harness | A design document: front matter `template: "<set>@<version>"` and `unit`, then the sections and tables the template names |
| `generated/traceability.md` | `rebuild_aggregates.py` | Front matter with the totals the headlines read; one row per understood unit |
| `generated/BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `README.md` | `rebuild_aggregates.py` | The units' rules, objects and findings joined; the index of the specifications |

## Scratch

The data a run passes between its steps is JSON under `scratch/<app>/` in the job workspace and is never committed: `inventory.json`, `topology.json`, `catalog.json`, `catalog-draft/`, `understand/` (`scope.json`, `shards.json`, `scan.json`, `rules_result.json`, `graph.json`, `plan-draft.json`, `briefs/`, `trace/`). The plans mark it `intermediate`.

## Limits

The job-output hook refuses a file over 1 MiB, and the API serves a file up to 2 MiB; the documents above stay under both by summarising (the inventory and the topology cap their tables, the catalog index lists at most 200 unassigned files). A module whose catalog document outgrows the API limit is not shown.
