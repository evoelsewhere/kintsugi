# Document reads and stage results

> Explains how the API and portal read document files and stage results.

The API reads the document repo **only from Kintsugi's mirror** under the data directory (`KINTSUGI_DATA_DIR`, kept current by the worker's Git sync), read-only, with plumbing commands of `packages/git`; it never clones, checks out or writes. A session is enough (no permission). Refs are a full commit id or an existing `refs/heads/<branch>`; paths are repository paths (no `..`, `.`, empty or `.git` segments); nothing under `restricted/` is ever served (restricted records are not committed, [ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)).

## Read API

| Endpoint | Returns |
|---|---|
| `GET /api/projects/:id/documents/refs` | The default branch tip and the output branches of recent successful stage runs and document writes, each `merged` (its tip is on the default branch) or `open`, newest first. |
| `GET /api/projects/:id/documents/tree?ref&path` | The entries of a directory at the ref (default: the default branch), directories first. |
| `GET /api/projects/:id/documents/file?ref&path` | A text file up to 2 MiB (413 above, 415 when binary). Every committed document is Markdown ([document formats](document-formats.md)); the response carries the text, front matter included. |
| `GET /api/projects/:id/applications/:appId/stages/:stage/results?ref&compare` | Results built from the files at the selected run's output ref, or the default branch. Current built-in plans are `assess` and `understand`: `assess` results are built from `inventory.md`, `ASSESSMENT.md` and `ARCHITECTURE.mmd`; `understand` results from the catalog and each understood unit's documents (`understanding/`), the AS-IS specifications, the unit state and the totals of `generated/traceability.md` (the traceability matrix is built from the units' own trace documents). The earlier separate `map`, `extract-rules` and `harden` stages are not current built-in plan stages; their assessment responsibilities are represented by the current plans. `compare=true` adds the counts from the previous successful run. |
| `GET /api/projects/:id/applications/:appId/catalog?ref` | The item catalog of the application (`applications/<app>/assessment/catalog/` at the ref, default: the default branch) with every item's derived status, its latest `understand` run, its open pull request and when it was understood ([item catalog](document-repo-item-catalog.md)). 404 until `assess` has written a catalog. |
| `GET /api/projects/:id/applications/:appId/results/headlines` | One or two headline numbers per result stage, for the Delivery overview. |

The stage page opens on **Results** once the stage has output, with **Runs & logs** (job runs, live log, latest output) and **Inputs & agents** as secondary tabs. A ref selector shows the latest result, the default branch or an older run; comparison uses the previous successful run. Current stage file paths and aggregate filenames are listed in the [layout](document-repo.md) and [item catalog](document-repo-item-catalog.md) references.

## Document rendering

Links in a rendered document resolve against the document's path in the document repo and open inside the portal at the same commit. Links to unit specifications or unit state open the unit view; `SEC-xxx` or `RULE-xxx` anchors into the stage's own document open the finding or rule; any other document opens in a document drawer (with a link to its stage results when it is a stage's main document). Web links open in a new tab; links that leave the repository, point under `restricted/` or `.git`, or use another scheme are shown but never followed.

Markdown is rendered without raw HTML; ` ```mermaid ` fences in any rendered document are drawn as diagrams; Mermaid runs with `securityLevel: "strict"`, in a box as tall as the diagram up to a maximum (larger ones pan and zoom). Result views, Markdown and Mermaid load only when needed.
