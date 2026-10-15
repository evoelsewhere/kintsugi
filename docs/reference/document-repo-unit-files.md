# Unit files

> Defines the unit state file and its frontmatter contract.

One file per unit ([ADR-0012](../decisions/0012-work-items-as-files-in-git.md)). The frontmatter is the unit's state. Postgres indexes it for the board and queries, and can rebuild the index from Git. Example: [`templates/document-repo/units/_example.example.md`](../../templates/document-repo/units/_example.example.md).

The legacy API/domain still expose `WorkItem`/`work-items` names. This reference uses **unit** and does not rename those API contracts.

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
| `gates` | Per-gate result: `status`, `by`, `at`, review record path |

**Proposed by the `understand` stage** ([ADR-0031](../decisions/0031-understand-stage-as-is-specification.md)): one file per unit the stage derives from the application's topology and catalog, with `phase: discover-assess`, `stage: understand`, `status: pending`, `complexity` from size, `dependsOn` from the traceability matrix, the legacy `source` paths and `links.asIs` / `links.businessRules`. They arrive in the stage's pull request, not as auto-commits; a unit that already has a file is left unchanged.

**Rules**:
- **Write path**: state changes go through the Kintsugi API (portal, CLI, MCP, runtime agents). The API validates the actor's effective access-role permissions and the allowed transition, updates the index, and the worker commits as `kintsugi-bot` with `Kintsugi-Actor`.
- **Direct edits** are allowed only through PRs. They are validated on sync; invalid changes are flagged and not indexed.
- **History** is Git history; there is no separate transition log.
