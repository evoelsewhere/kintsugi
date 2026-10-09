# Workspace repository

> Status: 🟡 proposed (D29). Layout and file formats are drafts.

Each project has one workspace repo holding everything except source code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)). It is created from the [starter template](../../templates/workspace/) or joined when it already exists ([build a project](../guides/build-project.md)).

## Layout

```
kintsugi.yaml                 # project manifest; pins the rulebook
rulebook/                     # the project's rules, see reference/rulebook.md
inventory/<app>.yaml
assessment/<app>/scorecard.md
architecture/adr/NNNN-*.md
knowledge/as-is/<app>/...     # AS-IS documents (generated + human-written)
knowledge/to-be/...
units/<app>/<module>/<unit>.md  # one file per work item; frontmatter = state (ADR-0012)
tasks/<work-item-id>.md       # task packs
reviews/<work-item-id>/...    # gate-reviewer records
deliverables/<phase>/...      # detail designs, test reports, ... (large binaries: D31)
golden/<unit>/cases/<id>/     # golden-master cases for compare (when equivalence testing is in scope)
runs/<unit>/<run-id>/         # small compare reports (raw actuals are not committed)
.kintsugi/plugins/kintsugi@<version>/   # vendored built-in plugin (generated)
.claude-plugin/marketplace.json         # generated marketplace (Claude Code, Copilot CLI)
.github/plugin/marketplace.json         # generated marketplace (Copilot CLI)
.agents/plugins/marketplace.json        # generated marketplace (Codex)
```

## `kintsugi.yaml` (draft)

```yaml
schemaVersion: 1
project:
  id: billing-modernization
  name: Billing modernization
rulebook:
  path: rulebook                   # version lives only in rulebook/rulebook.yaml
defaults:
  packs: [org-baseline]            # applied to every application
applications:
  - id: billing-web
    disposition: refactor          # 7R
    pipeline: refactor             # rulebook/pipelines/refactor.yaml
    packs: [webforms-to-aspnetcore]
    repos:
      - server: github-main        # GitServer id registered in the installation
        path: org/billing-web-legacy
        role: source               # read-only for the runtime; any number per application
      - server: azdo-internal
        path: Billing/_git/billing-web
        role: target               # scaffolded target base
  - id: payroll-batch
    disposition: rearchitect
    pipeline: rearchitect
    packs: [cobol-batch-to-java]   # a second stack pair in the same project
    repos:
      - {server: gitlab-onprem, path: legacy/payroll-cobol, role: source}
      - {server: gitlab-onprem, path: payroll/payroll-java, role: target}
autoCommitPaths:
  - units/**                      # state changes, committed by kintsugi-bot
  - tasks/**
  - knowledge/**/generated/**
policy:
  harnesses: [copilot, claude-code]
  requireCommitTrailer: true
```

## Commit conventions

| Who | Branch | Author | Trailers |
|---|---|---|---|
| Kintsugi worker (PR) | `kintsugi/<agent>/<job-id>` | `kintsugi-bot` | `Kintsugi-Job: <id>`, `Kintsugi-Agent: <agent>@<version>`, `Kintsugi-Rulebook: <version>@<commit>` |
| Kintsugi worker (auto-commit) | default branch | `kintsugi-bot` | same as above |
| State change on behalf of a user | default branch (`units/**`) | `kintsugi-bot` | `Kintsugi-Actor: <user>`, `Kintsugi-Unit: <unit-id>` |
| Members | own branches | the member | `Assisted-by: <harness>` when AI-assisted |
| Rulebook changes | own branches, PR approved by rulebook `owners` | the member | — (bump `version`) |

## Unit files

One file per work item ([ADR-0012](../decisions/0012-work-items-as-files-in-git.md)). The frontmatter is the unit's state. Postgres indexes it for the board and queries, and can rebuild the index from Git. Example: [`templates/workspace/units/_example.example.md`](../../templates/workspace/units/_example.example.md).

| Field | Description |
|---|---|
| `id` | `<application>/<module>/<unit>`, stable |
| `application`, `module`, `kind`, `title` | Identity; `kind` is one of the rulebook `units.kinds` |
| `wave`, `pilot`, `complexity` | Planning; `pilot: true` allows `draft` rulebook capabilities |
| `phase`, `stage`, `status` | Progress. `status`: `pending`, `in-progress`, `awaiting-review`, `approved`, `rejected`, `blocked`, `done`, `skipped` |
| `assignee`, `harness` | Who works on it, and with which member harness |
| `dependsOn` | Unit ids (used for leaves-first ordering) |
| `source`, `target` | `{repo, paths}` lists in the source (read-only) and target repos |
| `links` | Task pack, AS-IS doc, mappings, UI patterns, business rules, pull requests |
| `gates` | Per-gate result: `status`, `by`, `at`, review record path |
| `packs` | Packs resolved for the unit (defaults + application packs) |
| `rulesApplied` | Rule IDs applied when the unit was last planned / reviewed |
| `stale` | `{since, rules}`: set when one of `rulesApplied` changed afterwards; the unit goes to the re-review queue |
| `waivers` | Waiver IDs the last run relied on |
| `rulebook` | `version` and `commit` the unit was last processed with |

**Rules**:
- **Write path**: state changes go through the Kintsugi API (portal, CLI, MCP, runtime agents). The API validates the role and the allowed transition, updates the index, and the worker commits as `kintsugi-bot` with `Kintsugi-Actor`.
- **Direct edits** are allowed only through PRs. They are validated on sync; invalid changes are flagged and not indexed.
- **History** is Git history; there is no separate transition log.

## Open questions (D29)

- A dedicated repo (proposed) or a `kintsugi/` folder inside an existing repo.
- Which paths are auto-committed by default.
