# Item catalog

> Defines the application item catalog produced by `assess` and consumed by `understand` and `plan-understand`.

`10-applications/<app>/01-legacy/_catalog/` lists what a person can select for understanding. It is the menu of `assess` ([ADR-0033](../decisions/0033-assess-catalog-understand-selection.md)); the document repo holds it as Markdown ([ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md), [document formats](document-formats.md)). An entry is a catalog **item** (`<module>/<item>`); once selected, it becomes a **unit** with its own directory. This page keeps "item" for catalog entries and "unit" for the thing being migrated; the API still exposes legacy `WorkItem`/`work-items` names.

## Documents

```text
assessment/catalog/
  index.md          modules and items as tables, the ambiguities, the unassigned files
  <module>.md       one card per item of the module
```

`index.md` has front matter (`app`, `sources`: the `<repository id>@<commit>` of each legacy repository, counts) and the tables `Modules` (module, name, items, summary) and `Items` (item, name, kind, status, LOC, complexity, files), then the lists `Ambiguities` (what a person should check) and `Unassigned files` (inventory files in no item: documentation, build files, code the topology did not place; the first 200, the count is in the front matter).

A card in `<module>.md` is a heading `## <module>/<item>: <name>`, the item's summary and:

| Part | Content |
|---|---|
| Fields | `kind` (one of the `unitKinds` of `kintsugi.yaml`), `status` (`active` or `retired`), `loc`, `complexity` (`low`, `medium`, `high`), `digest` (`sha256:` over the item's files and their hashes), `aliases` (earlier names) |
| `Leaves` | the topology leaves the item was built from: leaf, name, kind, file, LOC, entry point |
| `Depends on` | the items it calls, with the kinds of calls and their number |
| `Used by` | the items that call it |
| `Data stores` | the stores it reads or writes |
| `Parts` | functions or sections of a large item: shown, never selectable |
| `Files` | its source files; every inventory file is in exactly one active item or unassigned |

Ids are `<segment>/<segment>` of `[a-z0-9][a-z0-9-]{0,62}`. The links between items (`Depends on`, `Used by`, `Data stores`) are computed by `render_catalog.py` from the topology's edges, so the planning stage needs no topology.

## Item kinds

An item has one `kind`, one of the project's `unitKinds` ([ADR-0060](../decisions/0060-item-kinds-and-kind-aware-understanding.md)). Kintsugi knows seven core kinds, named by what the item is to the outside world, not by technology:

| Kind | An item that is… | Web / modern examples | Mainframe examples |
|---|---|---|---|
| `screen` | an interactive page or form a person works in | a routed view, page, form, dialog | a CICS transaction with a BMS map, an ISPF panel, a 3270 program |
| `api` | a synchronous interface other programs call | a REST, SOAP or RPC endpoint group | a CICS program exposed as a service, a stored procedure exposed to callers |
| `batch-job` | unattended work started by a schedule or an operator | a scheduled task, a cron script | a JCL job or procedure with the programs it runs |
| `report` | something that produces a document or an extract for people | a report template, an export | a print program writing a report dataset |
| `event` | a handler that reacts to a message | a queue or topic listener, a webhook | an MQ-triggered program |
| `integration` | an exchange of data with an external system | a file feed, an SFTP or EDI exchange | a file transfer step, an outbound queue writer |
| `module` | logic with no entry point of its own, used by other items (the default) | a service, a library of rules | a called subprogram |

The first six are entry kinds (how the system is triggered). A project that declares no `unitKinds` gets all seven; it may declare a subset and add kinds of its own (a kind outside the core has no built-in [specification profile](specification-profiles.md)). Data is not an item kind: data objects stay in the DTO catalog (`data-objects.md` per item) and a `datastore` leaf of the topology is never an item.

`catalog_from_topology.py` maps the leaf kind of the topology onto the kinds the project allows: the leaf kind itself, then its aliases and synonyms (`controller` and `endpoint` are `api`, `batch` is `job`, `job` is `batch-job`, `page` and `map` are `screen`, `listener` is `event`, `feed` is `integration`, …), then `module`. When nothing fits, the item takes `module` (or the first kind when `module` is not allowed) and the catalog's `Ambiguities` says so (`<item> has no kind in unitKinds for the leaf kind "<x>"`). A generic `module` leaf that is an entry point of the application takes the first of `api`, `service`, `transaction`, `program` that the project allows. The curation job may correct a kind (`set-kind`); an item's id does not change with its kind. A file that serves two roles belongs to the item of its main role; the other role is listed as a `Part` with its own kind.

The leaf kinds the topology extraction may write are `screen`, `api`, `job`, `report`, `event`, `interface`, `module` and `datastore`. A `screen` that calls an endpoint has a `call` edge to the `api` leaf that serves it, across repositories when the application has several.

## Status

An item's status is derived, never stored in the card: `not-analysed`, `running`, `in-pr`, `failed`, `understood`, `stale` or `retired` (the card's `status` only says whether the item still exists). `understood` means `10-applications/<app>/01-legacy/<module>/<item>/understanding.md` is on the default branch; `stale` means the digest in that record differs from the card's. See [reads and stage results](document-repo-read-path.md).

## Who writes what

- **`assess`** writes the catalog: `catalog_from_topology.py` proposes it from the run's scratch topology and inventory, a curation job returns structured edits, `apply_catalog_edits.py` applies the valid ones, `reconcile_catalog.py` keeps ids, `render_catalog.py` writes the Markdown.
- **`understand`** writes the per-unit documents under `10-applications/<app>/01-legacy/<module>/<unit>/` ([unit files](document-repo-unit-files.md)).
- **`rebuild_aggregates.py`** rebuilds the read models under `10-applications/<app>/_generated/` after a merge (auto-committed).
- Selected catalog items become units; there is no selected-unit scope export file.

### Catalog reconciliation

Before the catalog is written, `reconcile_catalog.py` reads the previous catalog (this folder on the default branch) and **preserves ids**: a new item whose files overlap an old item's by half (Jaccard) keeps its id, a renamed item keeps its old name in `aliases`, a split keeps the id on its largest piece, a merged item takes the id of the first. An old item that matches nothing stays with `status: retired`, never deleted, so its specifications still resolve. Without a previous catalog, the ids of the unit cards in `10-applications/<app>/02-modern/<module>/<unit>/README.md` are kept.

## Rules and findings per unit

The extract-rules workflow runs over the selected items' shards. `split_rules.py` writes, in each unit's folder `10-applications/<app>/01-legacy/<module>/<unit>/`, `rules.md` (the index), a file per rule under `rules/` and `data-objects.md`; `split_findings.py` writes `findings.md`. The application-level views (`BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, `traceability.md`, `README.md`) are not written by the run: `rebuild_aggregates.py` rebuilds them under `10-applications/<app>/_generated/` after a merge.

**Identity.** Rule ids are deterministic and citation-derived, so they are stable across re-extractions and human verdicts keep matching. Verdicts (`confirmed`, `refuted`, `clarify`, approver, date) live in the unit's `rules-review.md`; a verdict whose rule id is absent from the current extraction is reported as orphaned, not silently applied (see [unit files](document-repo-unit-files.md#rulesmd-and-rules-reviewmd)).

## Changes

Changing the catalog is a pull request to the document repo. `assess` reconciles ids with the existing catalog.
