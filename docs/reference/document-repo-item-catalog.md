# Item catalog

> Defines the application item catalog produced by `assess` and consumed by `understand`.

`assessment/<app>/catalog.json` lists what an application consists of, as items a person can select for the `understand` stage ([ADR-0033](../decisions/0033-assess-catalog-understand-selection.md)). Only `assess` writes it. Types: `Catalog` and `CatalogItem` in [`packages/domain`](../../packages/domain/src/catalog.ts); reader: `parseItemCatalog` in `@kintsugi/agents/reader`.

```json
{ "schemaVersion": 1, "app": "billing", "generatedBy": "reconcile_catalog.py",
  "source": { "repo": "<repository id>", "commit": "<commit>" },
  "modules": [ { "id": "invoicing", "name": "Invoicing", "summary": "..." } ],
  "items": [ { "id": "invoicing/invoice-entry", "module": "invoicing", "kind": "screen",
      "name": "Invoice entry", "summary": "...", "files": ["src/inv/INV01.cbl"], "leaves": ["INV01"],
      "entryPoints": ["INV01"], "loc": 1840, "complexity": "medium", "digest": "sha256:...",
      "status": "active", "aliases": [], "parts": [ { "name": "calcTax", "kind": "function", "file": "src/inv/INV01.cbl:210" } ] } ],
  "unassigned": ["docs/notes.txt"],
  "ambiguities": ["..."] }
```

| Field | Meaning |
|---|---|
| `items[].id` | `<module>/<item>`, two kebab-case segments. The corresponding unit id is `<app>/<module>/<item>`: catalog items are the units. Ids survive re-assessment (below) |
| `kind` | One of `unitKinds` in `kintsugi.yaml`, mapped from the topology leaf kind |
| `files` | The source files of the item. Every source file of `inventory.json` is in exactly one item or in `unassigned` |
| `loc`, `complexity` | Code lines summed from `inventory.json`, and a `low`, `medium` or `high` band of the summed cyclomatic complexity |
| `digest` | `sha256:` over the item's files and their per-file sha256 from `inventory.json`; a different digest means the item changed |
| `status` | `active`, or `retired` for an item that no longer matches anything after a re-assessment (never deleted) |
| `aliases` | Earlier names of the item |
| `parts` | Functions or sections inside the item: shown, never selectable |
| `leaves` | The topology leaf ids the item was built from; `entryPoints` the ones that are entry points |

**Configured unit kinds.** `catalog_from_topology.py` maps eligible topology leaves to the manifest's `unitKinds`; datastore leaves are not selectable units. The template's `unitKinds: [module]` is compatible: with only `module` declared, generic module leaves keep that kind and other eligible leaves such as jobs or screens fall back to the first configured kind (`module`). This is valid but intentionally coarsens their catalog kind; declare additional kinds when the project needs to distinguish them.

**How `assess` builds it**: `catalog_from_topology.py` turns the topology's leaves into items (domain → module, the grouping rules of ADR-0031 §3) and checks file coverage; a `legacy-analyst` job proposes structured edits (rename, kind, merge, split, move files, summaries) that `apply_catalog_edits.py` validates and applies, rejecting any edit that would break coverage; `reconcile_catalog.py` then keeps the ids of the previous catalog on the default branch: an item overlapping an old one by Jaccard ≥ 0.5 on its files keeps the old id (a changed name goes to `aliases`), a split keeps the id on its largest piece, and an old item without a match is kept as `retired`. The first reconcile is seeded from `knowledge/as-is/<app>/units.json` and the existing `units/<app>/**`, so earlier unit ids are kept.

**Item status** is derived by the API, never stored (`GET /api/projects/:id/applications/:appId/catalog`), in this order of precedence:

| Status | When |
|---|---|
| `running` | a queued or running `understand` run has the item in its `inputs.scope.items` |
| `in-pr` | an `understand` run with the item opened a pull request that is still open (and was not abandoned) |
| `failed` | the item's latest run failed after it was last understood |
| `stale` | understood, but the `digest` in its `meta.json` differs from the catalog's |
| `understood` | `knowledge/as-is/<app>/items/<module>/<item>/meta.json` is on the default branch |
| `not-analysed` | none of the above |

A `retired` item keeps the status `retired`.

**Per-unit outputs and aggregates.** `understand` runs on selected catalog items and writes per-unit evidence: `assessment/<app>/items/<module>/<unit>/{topology.json,rules.json,findings.json}`, `assessment/<app>/understand/briefs/`, `knowledge/as-is/<app>/<module>/<unit>.md`, `knowledge/as-is/<app>/items/<module>/<unit>/{meta.json,trace.json}`, and `units/<app>/<module>/<unit>.md`. Independent units can be processed without sharing the same output paths.

After merge, `rebuild_aggregates.py` writes exactly these application-wide files:

- `assessment/<app>/generated/{topology.json,rules_result.json,BUSINESS_RULES.md,DATA_OBJECTS.md,SECURITY_FINDINGS.md}`
- `knowledge/as-is/<app>/generated/{README.md,traceability.json,traceability.md}`

The generated aggregates are rebuilt from merged per-unit files and auto-committed; they do not appear in an `understand` run's pull request. Rule and finding ids are namespaced by unit (for example `RULE-invoicing.invoice-entry-03`, `SEC-invoicing.invoice-entry-01`). Rule ids are currently numbered from the extracted rules' order after sorting by category, name and source within each unit, so they are reproducible for an unchanged rule set but are not guaranteed stable across reruns: adding, removing, or changing a rule earlier in that order can renumber later rules. The current plan writes extracted rules to `rules.json` and has no `rules-review.json` output path. Persisting human verdicts separately is a proposed layout change, not current behavior.
