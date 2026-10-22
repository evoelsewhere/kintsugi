# ADR-0042: A Markdown-only document repo, organized by bounded context

- Status: Accepted (Modernization context refined by 0044 and 0045; the tree and the paths of decisions 4 and 5 are superseded by [ADR-0051](0051-document-repo-layout-legacy-and-modern.md))
- Date: 2026-10-21
- Decision register: D58

## Context

The document repo is read by people in pull requests and by AI agents as context. Its machine output was mostly JSON: `inventory.json` with a record per source file, `topology.json` with every leaf and edge, `catalog.json`, and per unit `rules.json`, `rules-review.json`, `findings.json`, `topology.json`, `trace.json` and `meta.json`, plus `plan.json` and the generated `traceability.json`. JSON diffs poorly in review, hides prose (a rule's `given/when/then`, a finding's fix) inside escaped strings, and costs a model tokens for punctuation. Several of these files could not even be read as a whole: `inventory.json` lists up to 25,000 files, `topology.json` up to 200,000 edges, and the job-output hook refuses a file over 1 MiB.

[ADR-0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) organized the repo by subject and SDLC phase, but the machine files of one unit still sat beside its authored documents, and the assessment of an application, what is understood about it and the unit that is later modernized were not separate in the vocabulary. The app has no users yet, so nothing needs to be kept for compatibility.

## Decision

**1. The document repo holds no JSON.** Every file a run commits is Markdown with the shapes of [Document formats](../reference/document-formats.md): YAML front matter for scalars and short lists, GFM tables for records, and cards (`### id: title`, field bullets, subsections) for records that carry prose or nested fields. Scripts write them (`scripts/docmd.py`), the readers parse them (`hooks/reader/document.ts`); one spec describes both.

**2. What the steps of a run pass to each other is scratch.** Agent results with a JSON schema, the per-file inventory, the raw topology, the catalog drafts, the scope, briefs, shards, the item graph and the workflows' results stay JSON, because an agent answers a schema more reliably than free text. They live under `scratch/<app>/` in the job workspace, outside the document layout, marked intermediate and never committed. A script renders the committed Markdown at the end of the step.

**3. Summarise, do not enumerate.** The committed documents keep what a person or a model reads: the inventory by language, directory and most complex file; the topology by domain with the edges between domains and the largest leaves; the catalog with each item's links to the others. The per-file and per-edge detail is recomputable from the source commit and stays in scratch.

**4. Bounded contexts.** The layout follows the contexts of the method, with the unit as the aggregate:

| Context | Question it answers | Where | Aggregate / documents |
|---|---|---|---|
| Assessment | What is the estate? | `applications/<app>/assessment/` | `inventory.md`, `topology.md`, the catalog (`catalog/index.md`, `catalog/<module>.md`), `ASSESSMENT.md` |
| Understanding | What does it do, and what to read next? | `applications/<app>/understanding/plan.md`; per unit `understanding/` | `as-is.md`, `understanding.md`, `rules.md` (an index, one file per rule in `rules/`, [ADR-0046](0046-one-file-per-business-rule.md)), `data-objects.md`, `rules-review.md`, `findings.md`, `topology.md`, `trace.md` |
| Modernization | What are we building? | `to-be/`, per unit `task.md`, `design/<set>/` | refined by [ADR-0044](0044-design-phase-common-basic-detail.md) and [ADR-0045](0045-design-templates-are-project-data.md) |
| Governance | Who decided? | `gates/`, per unit `reviews/` | unchanged |

`units/<module>/<unit>/` is the **Unit aggregate**: `unit.md` is its root and holds its state; each context writes into its own subfolder. `generated/` holds the read models rebuilt after a merge (`BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.md`, `README.md`). `traceability.md` keeps only the totals and a row per unit; the traceability matrix the API serves is built from the units' own documents. The context map and the glossary are in [Document repo contexts](../architecture/concepts/document-repo-contexts.md).

**5. Paths.** `packages/domain/src/document-layout.ts` stays the sole owner of path construction (`scripts/paths.py` and the reader's `layout.ts` mirror it). The auto-commit default for the plan becomes `applications/*/understanding/plan.md`. `unitMetaPath`, `units.json`, `catalog-draft/` and the `knowledgeAsIs*` and `assessmentItem*` helpers are removed.

**6. No legacy.** Old files are not read, converted or kept: the readers parse Markdown only, the API returns text for every file (no `format: "json"`), and the dormant scripts of the earlier map/units flows (`units_from_topology`, `merge_traceability`, `write_work_items`, `merge_topology`, `node_packets`, `make_shards`) are deleted.

## Consequences

- A pull request of an assess or understand run reads as a document: tables for the catalog and verdicts, cards for the rules, findings as a table. A model reading `catalog/<module>.md` gets an item's facts, links and files in one place.
- The understand stage no longer receives the leaf-level topology: a unit's `understanding/topology.md` holds its leaves from the catalog card and its links to other items. The planning stage computes its item graph from the catalog alone, so it needs no source checkout.
- The portal's Assessment views change with the data: the inventory view lists the hotspots (the 50 most complex files) and the roll-ups, not every file; the map view shows the largest leaves and the edges between domains.
- `rules-review.md` is a table `Rule | Verdict | Approver | Date`; a person edits it in a pull request, and a verdict whose rule id is not in `rules.md` is still reported as orphaned.
- Existing document repos need a one-time rerun of `assess` and `understand`; nothing is migrated in place.

## Alternatives considered

- **Keep JSON, add Markdown renderings.** Two sources of truth that drift, and the AI still reads the larger file; rejected.
- **Markdown for the scratch data too.** Free-text results from an agent need a parser that guesses; the JSON schema of a structured result is the point; rejected for the job-to-job data, which never reaches the repo.
- **Shard the full topology into `topology/<module>.md`.** Keeps every edge but multiplies large files for a detail the source regenerates; kept as the fallback if the summaries prove too thin.
