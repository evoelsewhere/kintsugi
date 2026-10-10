# Document repository

> Status: ✅ decided ([ADR-0019](../decisions/0019-workspace-repo-write-path.md), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md), D29, D48). File formats are still drafts.

Each project has exactly one document repo. It holds everything except code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)): the manifest, the AS-IS analysis, the TO-BE documents, the work items and the project's standards. It is created from the [starter template](../../templates/document-repo/) or joined when it already exists ([build a project](../guides/build-project.md)).

## Layout

```
kintsugi.yaml                 # project manifest: document repo, applications and their repos, pipelines
assessment/<app>/scorecard.md
assessment/<app>/...           # understanding-phase artifacts (ADR-0027): INTENT.md, PREFLIGHT.md, ASSESSMENT.md,
                              #   topology.json, BUSINESS_RULES.md, DATA_OBJECTS.md, RULE_REVIEWS.json, DELTA_CATALOG.md,
                              #   SECURITY_FINDINGS.md, MODERNIZATION_BRIEF.md, VERIFICATION.md
knowledge/as-is/<app>/...     # AS-IS documents (generated + human-written)
knowledge/to-be/...           # TO-BE documents
architecture/adr/NNNN-*.md    # project ADRs
standards/conventions/        # target conventions (plain Markdown)
standards/mappings/           # legacy construct or UI pattern -> target, one file per mapping
standards/review-rules.md     # the rules reviewers enforce
plugins/<plugin>/             # member plugins, Claude Code plugin format (ADR-0015)
units/<app>/<module>/<unit>.md  # one file per work item; frontmatter = state (ADR-0012)
tasks/<work-item-id>.md       # task packs
reviews/<work-item-id>/...    # gate-reviewer records
deliverables/<phase>/...      # detail designs, test reports, ... (large binaries: D31)
golden/<unit>/cases/<id>/     # golden-master cases for compare: inputs + legacy outputs, listed in golden/<unit>/cases.json
golden/<unit>/fresh/<id>/     # fresh inputs invented by verify, listed in golden/<unit>/fresh-cases.json
runs/<unit>/<run-id>/         # small reports per run (EQUIVALENCE.json, test-runs.json, test and canary logs); raw actuals are not committed
.kintsugi/plugins/kintsugi@<version>/   # vendored built-in plugin (generated)
.claude-plugin/marketplace.json         # generated marketplace (Claude Code, Copilot CLI)
.github/plugin/marketplace.json         # generated marketplace (Copilot CLI)
.agents/plugins/marketplace.json        # generated marketplace (Codex)
```

`standards/` and `plugins/` have no schema and no maturity: a standard applies once it is merged, and every valid plugin is published to the project marketplace.

## Repository model

| Group | Role | Count | Who writes |
|---|---|---|---|
| Project | `document` | exactly one, declared at project level | Kintsugi (`kintsugi-bot`) and members, through PRs or `autoCommitPaths` |
| AS-IS (per application) | `legacy` | any number: legacy code | Nobody through Kintsugi; read-only |
| AS-IS (per application) | `legacy-data` | any number: schemas, dumps, reference data | Nobody through Kintsugi; read-only |
| TO-BE (per application) | `target` | any number, each with `component: <name from the architecture>` | Members only; the runtime never writes |

The document repo holds both the AS-IS analysis and the TO-BE documents; the portal may show it under TO-BE.

## `kintsugi.yaml` (draft)

```yaml
schemaVersion: 1
project:
  id: billing-modernization
  name: Billing modernization
document:
  server: github-main              # GitServer id registered in the installation
  path: org/billing-docs
unitKinds: [screen, api, batch-job]
applications:
  - id: billing-web
    disposition: refactor          # 7R
    pipeline: refactor             # a built-in pipeline, or one declared under `pipelines:`
    repos:
      - {server: github-main, path: org/billing-web-legacy, role: legacy}
      - {server: github-main, path: org/billing-db, role: legacy-data}
      - {server: azdo-internal, path: Billing/_git/billing-web, role: target, component: web}
      - {server: azdo-internal, path: Billing/_git/billing-api, role: target, component: api}
  - id: payroll-batch
    disposition: rearchitect
    pipeline: payroll-rearchitect
    repos:
      - {server: gitlab-onprem, path: legacy/payroll-cobol, role: legacy}
      - {server: gitlab-onprem, path: payroll/payroll-java, role: target, component: payroll-service}
pipelines:
  - id: payroll-rearchitect
    appliesTo: {dispositions: [rearchitect]}
    phases:
      - id: migrate
        perUnit: true
        stages:
          - {id: implement, performer: {member: [dev]}}
          - {id: review, performer: {agent: gate-reviewer}}
          - {id: approve, performer: {member: [core-team]}, gate: G4}
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
| Kintsugi worker (PR) | `kintsugi/<agent>/<job-id>` | `kintsugi-bot` | `Kintsugi-Job: <id>`, `Kintsugi-Agent: <agent>@<version>` |
| Kintsugi worker (auto-commit) | default branch | `kintsugi-bot` | same as above |
| State change on behalf of a user | default branch (`units/**`) | `kintsugi-bot` | `Kintsugi-Actor: <user>`, `Kintsugi-Unit: <unit-id>` |
| Members | own branches | the member | `Assisted-by: <harness>` when AI-assisted |
| Standards and plugins changes | own branches, PR reviewed by the architect | the member | — |

Provenance records the document repo commit an artifact was produced against.

## Unit files

One file per work item ([ADR-0012](../decisions/0012-work-items-as-files-in-git.md)). The frontmatter is the unit's state. Postgres indexes it for the board and queries, and can rebuild the index from Git. Example: [`templates/document-repo/units/_example.example.md`](../../templates/document-repo/units/_example.example.md).

| Field | Description |
|---|---|
| `id` | `<application>/<module>/<unit>`, stable |
| `application`, `module`, `kind`, `title` | Identity; `kind` is one of the `unitKinds` in `kintsugi.yaml` |
| `wave`, `pilot`, `complexity` | Planning |
| `phase`, `stage`, `status` | Progress. `status`: `pending`, `in-progress`, `awaiting-review`, `approved`, `rejected`, `blocked`, `done`, `skipped` |
| `assignee`, `harness` | Who works on it, and with which member harness |
| `dependsOn` | Unit ids (used for leaves-first ordering) |
| `source`, `target` | `{repo, paths}` lists in the legacy (read-only) and target repos |
| `links` | Task pack, AS-IS doc, mappings (paths under `standards/mappings/`), business rules, pull requests |
| `gates` | Per-gate result: `status`, `by`, `at`, review record path |

**Rules**:
- **Write path**: state changes go through the Kintsugi API (portal, CLI, MCP, runtime agents). The API validates the actor's effective access-role permissions and the allowed transition, updates the index, and the worker commits as `kintsugi-bot` with `Kintsugi-Actor`.
- **Direct edits** are allowed only through PRs. They are validated on sync; invalid changes are flagged and not indexed.
- **History** is Git history; there is no separate transition log.

## Resolved by ADR-0019

- **Dedicated repo, or a `kintsugi/` folder inside an existing repo?** A dedicated document repo per project.
- **Which paths are auto-committed by default?** `units/**`, `tasks/**`, `knowledge/**/generated/**` (`autoCommitPaths` in `kintsugi.yaml`); everything else lands on `kintsugi/<agent>/<job-id>` branches as pull requests.
