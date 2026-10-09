# ADR-0019: One workspace repo per project; the worker writes as `kintsugi-bot`

- Status: Accepted
- Date: 2026-10-09
- Decision register: D29

## Context

Everything except source code lives in a per-project workspace repo (ADR-0007): work-item state as unit files (ADR-0012), the rulebook (ADR-0011), task packs, deliverables and knowledge documents. The register left open how the runtime's results reach Git and how state changes are committed. Constraints:

- Runtime jobs never write to repositories directly (ADR-0004): they write to `/out`, and something else must commit.
- Concurrency is real: several jobs and several users can change the workspace at the same time.
- Git history doubles as the audit trail for document state (ADR-0012: "history is Git history"), so commits must identify who or what acted.
- Trackers (Jira / Azure DevOps) are mirrors, never the source of truth.

## Decision

- **One dedicated workspace repo per project.** Not a `kintsugi/` folder inside an existing code repo: access, history and review rules differ from code.
- **Single write path**: state changes and runtime results go through the Kintsugi API → the worker (`services/orchestrator`, Git Sync & Writer) → Git. Nothing else pushes to the workspace repo.
- **Bot identity**: every automated commit is authored by `kintsugi-bot` and carries trailers (see [workspace repo reference](../reference/workspace-repo.md#commit-conventions)):
  - job results: `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Rulebook`;
  - state changes on behalf of a user: `Kintsugi-Actor`, `Kintsugi-Unit`.
- **Branch strategy**:
  - Runtime job results land on `kintsugi/<agent>/<job-id>` and are proposed as a **pull request** by default.
  - Paths matching `autoCommitPaths` in `kintsugi.yaml` are committed **directly to the default branch** (task packs, unit state, generated documents) — these are high-frequency, low-risk writes where a PR per change would drown reviewers.
  - **Default `autoCommitPaths`**: `units/**`, `tasks/**`, `knowledge/**/generated/**`. Projects can widen or narrow the list in `kintsugi.yaml`.
- **Writer mechanics**: plain git — fetch → rebase → retry on non-fast-forward, one writer per workspace repo at a time (serialized through the job queue). The writer validates `/out` output rules before committing.
- **Direct human edits** are allowed only through PRs and are validated on sync; invalid changes (e.g. broken unit frontmatter) are flagged and not indexed.

## Consequences

- The workspace repo history is the authoritative record for work-item state and deliverables; Postgres is a rebuildable index (ADR-0012).
- Reviewers see runtime output as ordinary PRs, with provenance in trailers; `autoCommitPaths` keeps routine state changes out of review queues.
- A misbehaving bot is contained: the bot's credentials can only push to the workspace repo, and everything it writes is attributed in trailers.
- The PR-per-job model needs a Git server with PR support; plain-git-only servers fall back to direct commits on `kintsugi/*` branches (covered by the `GitServerKind` in the domain model).
- Open (D31): large binaries (recordings, scanned PDFs) — Git LFS where supported, otherwise the `kintsugi-data` volume plus a link file.

## Alternatives considered

- **A `kintsugi/` folder in an existing repo**: rejected; mixes access control and history of documents with code, and forces the writer to contend with human branches.
- **Runtime agents commit directly**: rejected; ADR-0004 keeps jobs unable to write to repos, and direct pushes would break attribution and review.
- **A separate transition log (DB)** for state changes: rejected; ADR-0012 makes Git history the log.
