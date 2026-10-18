# Item catalog

> Defines the application item catalog produced by `assess` and consumed by `understand`.

`applications/<app>/assessment/catalog.json` lists what a person can select for migration. It is the single deliverable of `assess`: everything else in `applications/<app>/assessment/` is synthesized beside it or written by `understand` ([ADR-0033](../decisions/0033-assess-catalog-understand-selection.md)). An entry is a catalog **item** (`<module>/<item>`); once selected, it becomes a **unit** with its own directory. This page keeps "item" for catalog entries and uses "unit" for the thing being migrated; the API still exposes legacy `WorkItem`/`work-items` names.

```json
{
  "application": "billing",
  "items": [
    {
      "module": "invoices",
      "name": "invoice-search",
      "source": "src/INVOICES/SEARCH.cbl",
      "entryPoint": "INVOICE-SEARCH",
      "kind": "screen",
      "status": "not-assessed",
      "tier": "gold"
    }
  ],
  "generatedBy": "legacy-analyst"
}
```

- `application` is the manifest application id from `kintsugi.yaml`.
- `items[].module` and `items[].name` are `[a-z0-9][a-z0-9-]{0,62}` (kebab-case); `itemKey` is `<module>/<name>` and is unique within the catalog.
- `source` is the owning legacy code path (file or folder). `entryPoint` is optional (copybooks and screens have none).
- `kind` is one of the `unitKinds` in `kintsugi.yaml`; `tier` is optional (`gold`, `silver`, `bronze`).
- `status` is one of `not-assessed`, `in-progress`, `assessed`, `selected`, `not-selected`, `excluded`, `stale`, `understood`, `not-analysed`, `retired` (derived by the API from catalog and run files, see [reads and stage results](document-repo-read-path.md)). A `selected` item becomes a unit; `understood` is set when `applications/<app>/units/<module>/<item>/meta.json` is on the default branch.

Path facts:
- **Written by `assess`** (catalog reconciliation): `applications/<app>/assessment/catalog.json` and `units.json` (a legacy id index read during reconciliation).
- **Written by `understand`**: the per-unit files under `applications/<app>/units/<module>/<unit>/` and the briefs under `applications/<app>/assessment/understand/briefs/`.
- **Rebuilt after merge** by `rebuild_aggregates.py`: the application aggregates under `applications/<app>/generated/` (auto-committed).
- **Selected catalog items become units**; there is no selected-unit scope export file.

### Catalog reconciliation (understand setup)

Before the `understand` run, `reconcile_catalog.py` refreshes `applications/<app>/assessment/catalog.json` from the source inventory. It seeds from `applications/<app>/assessment/units.json` and the existing `applications/<app>/units/**` unit state, and it **preserves ids**: an unchanged source path keeps its `module/name`. Unmatched catalog items become `retired`; `understood` and `stale` are unchanged on refresh. A changed `source` or `entryPoint` keeps the same item and raises a warning.

## Rule extraction per unit

The extract-rules workflow runs one extraction per unit. `split_rules.py` shards the extraction result into `applications/<app>/units/<module>/<unit>/rules.json` (one shard per unit); `split_findings.py` writes `applications/<app>/units/<module>/<unit>/findings.json`. The application-level views (`rules_result.json`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.*`, `README.md`) are **not** written by the run: `rebuild_aggregates.py` rebuilds them under `applications/<app>/generated/` after a merge.

**Identity:** item names and rule ids are deterministic and citation-derived — each rule carries the source citation it was derived from — so they are stable across re-extractions and human verdicts in `rules-review.json` keep matching. Human rule verdicts (`confirmed`, `refuted`, `clarify`, approver, date) live in `applications/<app>/units/<module>/<unit>/rules-review.json`; a verdict whose rule id is absent from the current extraction is reported as orphaned, not silently applied (see [unit files](document-repo-unit-files.md#rulesjson-and-rules-reviewjson)).

## Changes

Changing the catalog is a pull request to the document repo. `assess` reconciles ids with the existing catalog; members follow [ADR-0031](../decisions/0031-understand-stage-as-is-specification.md) when the AS-IS specification is superseded.
