# ADR-0012: Work items are files in the workspace repo; Postgres indexes them

- Status: Accepted. Unit frontmatter extended by [ADR-0013](0013-composable-open-rulebook.md) (`packs`, `rulesApplied`, `stale`, `waivers`).
- Date: 2026-10-09
- Decision register: D20
- Amends: ADR-0003 (where pipeline state is persisted)

## Context
Git is the source of truth for code, documents and the rulebook (ADR-0007, ADR-0011). Work items (units of migration) and their progress were still planned as database rows. That would make the database the only copy of the project's delivery state:
- it would not travel with the workspace repo, the customer deliverable;
- it would not be reviewable or revertible;
- it would be lost if the database were lost.

## Decision
- **One file per work item**: `units/<application>/<module>/<unit>.md` in the workspace repo.
  - The YAML frontmatter holds the unit's state: kind, wave, pilot flag, phase, stage, status, assignee, harness, dependencies, source/target paths, links, gate results.
  - The body is a short human-readable summary.
  - Format: [workspace repository reference](../reference/workspace-repo.md#unit-files).
- **Postgres keeps an index of the unit files** for the board, queries and metrics. It is rebuilt from Git at any time, and refreshed on every sync of the workspace repo.
- **Single write path**:
  - Portal actions, CLI / MCP calls (`task start`, `task.update`) and runtime agents change state through the Kintsugi API.
  - The API validates the actor's effective access-role permissions and the allowed transition, updates the index, and the worker commits the file change as `kintsugi-bot` with an actor trailer (`Kintsugi-Actor: <user>`).
  - If the commit fails, the index change is rolled back.
- **Direct edits** of unit files are allowed only through PRs. On sync, Kintsugi validates them (schema, transitions). Invalid changes are flagged on the board and are not applied to the index.
- **History**: Git history is the unit's history. Kintsugi does not keep a separate transition log, apart from the audit events of who triggered what.
- **Concurrency**: the worker commits with fetch → rebase → retry. Two concurrent changes to the same unit file fail fast for the second actor, and the error is shown. One file per unit keeps such conflicts rare; when one happens, it signals an assignment problem.
- **Trackers**: Jira / Azure DevOps are mirrors. Kintsugi pushes status to them and does not read state back from them.
- **What stays in Postgres only**: queue and job execution (pg-boss), job events, usage/cost, sessions, audit. These are operational and not part of the deliverable.

## Consequences
- The workspace repo alone describes the project: rules (rulebook), knowledge, plans, units and their status, reviews and results. It can be handed over or audited without Kintsugi.
- Losing Postgres loses only operational history. Units, statuses and gate results are rebuilt from Git (quality scenario Q7).
- Every state change is a commit, so the workspace repo sees frequent bot commits. `units/**` is an auto-commit path, and branch protection must allow `kintsugi-bot` to push there.
- Board freshness depends on sync. Changes made through Kintsugi show up immediately (index first, commit second). Changes made directly in Git appear after the next sync.
