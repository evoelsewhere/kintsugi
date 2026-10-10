# services/orchestrator

Runs inside `kintsugi-worker`. Postgres-backed job queue (pg-boss, ADR-0003) and, later, the pipeline/stage/gate state machine.

## Git sync (implemented)

Keeps one bare mirror per registered repository in Kintsugi's storage (`KINTSUGI_DATA_DIR`, ADR-0025), through `packages/git`:

- **Queue**: `git-sync` jobs, one per repository at a time (`stately` policy, `singletonKey` = repository id), retried with backoff.
- **First sync**: partial mirror clone (`--filter=blob:none`); a failed clone leaves no directory behind.
- **Later syncs**: `fetch --prune`; the commit of the default branch is recorded as `last_commit`.
- **Status**: `admin.git_repository.sync_status` moves `pending → cloning → ready`, or `error` with a redacted `last_error`. The portal shows it in Settings → Git.
- **Scheduling**: newly registered (`pending`) repositories are picked up within seconds; every repository is re-synced each `KINTSUGI_GIT_POLL_INTERVAL` seconds (default 180); mirrors of removed repositories are pruned.
- **Credentials**: the server's token or SSH key is decrypted (`KINTSUGI_SECRET_KEY`) for one git call and never written to the mirror.

pg-boss keeps its tables in its own `pgboss` schema: an infrastructure library, not one of the domain schemas.

## Planned

- **Job worktrees**: a per-job worktree at the job's commit, mounted read-only as `/src`.
- **Git writer**: validates a runtime job's `/out`, then commits to the workspace repo on `kintsugi/<agent>/<job-id>` and opens a PR (or auto-commits allowed paths) — ADR-0019.
- Runtime jobs (via the launcher in `services/runtime`), ingestion, webhooks (D30).

## Run

- Development: `make worker` (or `make dev` for everything); reads the root `.env`.
- Requires `git` 2.40+ on the host or in the image (checked at startup).
