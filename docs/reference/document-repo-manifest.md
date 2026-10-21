# Project manifest (`kintsugi.yaml`)

> Defines the manifest schema and how the portal and parser use it.

```yaml
schemaVersion: 1
project:
  id: billing-modernization
  name: Billing modernization
document:
  server: github-main              # Git server id registered in the installation
  path: org/billing-docs           # clone URL path relative to the server's base URL, without .git
unitKinds: [screen, api, batch-job]
applications:
  - id: billing-web
    name: Billing web
    disposition: refactor          # 7R
    pipeline: refactor             # a built-in pipeline, or one declared under `pipelines:`
    repos:
      - {server: github-main, path: org/billing-web-legacy, role: legacy}
      - {server: github-main, path: org/billing-db, role: legacy-data}
      - {server: azdo-internal, path: Billing/_git/billing-web, role: target, component: web}
      - {server: azdo-internal, path: Billing/_git/billing-api, role: target, component: api}
  - id: payroll-batch
    name: Payroll batch
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
  - applications/*/units/**/unit.md    # unit state changes, committed by kintsugi-bot
  - applications/*/units/**/task.md    # task packs
  - applications/*/generated/**        # application views rebuilt after a merge (ADR-0033, ADR-0038)
  - applications/*/understanding/plan.md   # the AI plan of what to understand next (ADR-0041)
policy:
  harnesses: [copilot, claude-code]
  requireCommitTrailer: true
```

Schema (`validateManifest` in `packages/domain`, `parseKintsugiYaml` in `packages/manifest`; every problem is reported with its path, e.g. `applications[0].repos[1].component`; unknown keys are problems):

| Key | Required | Content |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `project` | yes | `id` (kebab-case), `name`, optional `description` |
| `document` | yes | The document repo: `server` (Git server id), `path` |
| `unitKinds` | yes | Non-empty list of unit kinds, without duplicates; topology-to-kind mapping is described in the [item catalog reference](document-repo-item-catalog.md) |
| `applications` | yes | List (may be empty). Each: `id` (kebab-case, unique), optional `name`, `disposition` (7R), optional `pipeline` (id), `repos` |
| `applications[].repos` | no | Each: `server`, `path`, `role` (`legacy`, `legacy-data` or `target`; `document` is not allowed here), `component` (required for `target`, unique per application, forbidden otherwise). A `server` + `path` pair appears once in the file, the document repo included |
| `pipelines` | no (default `[]`) | Each: `id` (unique), optional `appliesTo.dispositions`, non-empty `phases` (`id`; `category` required for a custom phase; optional `perUnit`; non-empty `stages` with `id`, `performer` = `{agent: <id>}` or `{member: [<roles>]}`, optional `gate`), optional `gates` |
| `autoCommitPaths` | no | Globs (`**` spans folders; `*` and `?` stay within one segment); default `applications/*/units/**/unit.md`, `applications/*/units/**/task.md`, `applications/*/generated/**` (the ADR-0033 aggregate rebuild into the ADR-0038 application `generated/` area) and `applications/*/understanding/plan.md` (the planning run of ADR-0041, advice that every run replaces). An explicit list replaces the default rather than extending it. The writer reads it from `kintsugi.yaml` on the default branch, and uses the defaults when the file is missing or invalid |
| `policy` | no | `harnesses` (default: the built-in member harnesses), `requireCommitTrailer` (default `true`) |

`path` is the repository's clone URL path relative to its server's base URL, without `.git`: `https://dev.azure.com/acme/Billing/_git/web` on a server with base URL `https://dev.azure.com/acme` gives `Billing/_git/web`; `git@github.com:org/app.git` gives `org/app`. Pipeline ids are not yet checked against the built-in pipelines (their list is an open follow-up of ADR-0028).

**Rendered and published from the portal.** The project page shows, and `GET /api/admin/projects/:id/kintsugi.yaml` returns, the manifest rendered from the project's state in Postgres: project, document repo, applications and their repos. `unitKinds`, `pipelines`, `autoCommitPaths` and `policy` show defaults until the portal manages them. **Publish kintsugi.yaml** (`POST /api/admin/projects/:id/kintsugi.yaml/publish`, permission `projects.manage`) hands the rendered file to the [writer](document-repo-write-path.md) together with the starter structure of `templates/document-repo/` (body `{ "scaffold": false }` for the manifest alone): the project-level folders and one skeleton per application are create-only files, so what the repo already has is never replaced, and every path goes into one pull request from `kintsugi/<user>/<write-id>`. The project page lists recent writes with their status and pull-request link (`GET /api/admin/projects/:id/document-writes`).
