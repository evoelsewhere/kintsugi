# Git as the source of truth

Decision: [ADR-0007](../../decisions/0007-git-as-source-of-truth.md).

## Git servers and repositories

- **Git servers.** An installation registers any number of Git servers (`GitServer`: kind, base URL, credential). Supported kinds:
  - GitHub (cloud / Enterprise Server)
  - Azure DevOps
  - GitLab
  - Bitbucket
  - Gitea
  - plain git
- **Repositories.** A project references any number of repositories across those servers. Credentials are set per server, with an optional per-repository override.

| Repo role | Content | Who writes |
|---|---|---|
| **Legacy repo** (many per application) | Legacy source code | Nobody through Kintsugi: always read-only |
| **Target repo** (scaffolded target base) | New source code | Members, via branches/PRs |
| **Document repo** (one per project) | Everything except code: project manifest, assessment, ADRs, AS-IS/TO-BE docs, **standards**, plugins, units, task packs, reviews, deliverables, golden cases | Members + Kintsugi (worker) |

Layout and conventions: [document repository reference](../../reference/document-repo.md).

## How runtime results reach Git

The runner never writes to repositories:
1. A job writes only to the `out` directory of its job workspace.
2. When the job ends, the **worker** stores `out/restricted/` as restricted records, runs the JobOutput hook (credential scan, artifact checks) and validates the rest: allowed paths, size.
3. The worker commits to the document repo on `kintsugi/<agent>/<job-id>` and opens a PR. Paths configured as `auto-commit` are committed directly ❓ (D29).
4. On code repos the runtime only reads and comments on PRs.

## Member deliverables

Deliverables stay in their Git repositories:
1. The member commits code and documents on normal branches.
2. The member opens pull requests with the Kintsugi unit identity and required deliverable paths.
3. Kintsugi discovers provider state, binds review to exact revisions and records validated workflow evidence. The member connector does not require a separate artifact-register write.

## What Postgres keeps

- **Operational state**: users, memberships, job queue and executions, events, usage/cost, audit.
- **Indexes rebuildable from Git**: units and their status / gate results (from `applications/*/units/**`, [ADR-0012](../../decisions/0012-work-items-as-files-in-git.md)), KB chunks/embeddings, file → artifact mapping.
- **Not** the primary copy of any document. If the DB is lost, the KB can be rebuilt from Git; only operational history is lost.

## Unit state

Each unit is a directory, `applications/<app>/units/<module>/<unit>/`, whose `unit.md` frontmatter holds its state ([format](../../reference/document-repo-unit-files.md)).

- **One write path**:
  1. Portal and separately authorized API actions call the Kintsugi API. The member CLI/MCP connector is read-only and cannot claim a unit or change its state (ADRs 0041–0042).
  2. The API validates the actor's effective access-role permissions and the transition, then updates the index immediately.
  3. The worker commits the change as `kintsugi-bot` with a `Kintsugi-Actor` trailer.
  4. If the commit fails, the index change is rolled back.
- **Concurrency**: commits use fetch → rebase → retry. A second concurrent change to the same unit fails fast and the error is shown.
- **Direct edits** go through PRs and are validated on sync.
- **Trackers** (Jira / Azure DevOps) only mirror the status pushed by Kintsugi.

## Sync and change detection

| Mechanism | Covers | Notes |
|---|---|---|
| **Plain git** (HTTPS token or SSH deploy key) | Clone / fetch / push on every server | |
| **Provider API adapters** | PRs, comments, webhooks | Priority order: GitHub → Azure DevOps → GitLab → Bitbucket → Gitea. A server without an adapter gets sync and branch polling only |
| **Polling** | Change detection | The default (D30) |
| **Webhooks** | Change detection | Used when the Git server can reach the installation |

## Consequences

- Traceability for free: every KB entry, artifact and gate references `repo@commit:path`.
- Large binaries need Git LFS or a side volume (D31).
- The document repo layout is a contract, versioned by `kintsugi.yaml` `schemaVersion`.
