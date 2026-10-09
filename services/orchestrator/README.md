# services/orchestrator

Runs inside `kintsugi-worker`. Postgres-backed job queue (pg-boss) and the pipeline/stage/gate state machine (ADR-0003):

- consumes jobs: runtime jobs (via the launcher in `services/runtime`), git sync/polling, ingestion, commit/PR creation;
- **git sync**: clone/fetch code repos and the workspace repo (HTTPS/SSH), poll or receive webhooks for PRs;
- **git writer**: validates a runtime job's `/out`, then commits to the workspace repo on `kintsugi/<agent>/<job-id>` and opens a PR (or auto-commits allowed paths) — ADR-0007.
