# services/orchestrator

Runs inside `kintsugi-worker`. Postgres-backed job queue (pg-boss, ADR-0003), Git sync, the document repo writer and, later, the pipeline/stage/gate state machine.

## Git sync (implemented)

Keeps one bare mirror per registered repository in Kintsugi's storage (`KINTSUGI_DATA_DIR`, ADR-0025), through `packages/git`:

- **Queue**: `git-sync` jobs, one per repository at a time (`stately` policy, `singletonKey` = repository id), retried with backoff.
- **First sync**: partial mirror clone (`--filter=blob:none`); a failed clone leaves no directory behind.
- **Later syncs**: `fetch --prune`; the commit of the default branch is recorded as `last_commit`.
- **Status**: `admin.git_repository.sync_status` moves `pending → cloning → ready`, or `error` with a redacted `last_error`. The portal shows it in Settings → Git.
- **Scheduling**: newly registered (`pending`) repositories are picked up within seconds; every repository is re-synced each `KINTSUGI_GIT_POLL_INTERVAL` seconds (default 180); mirrors of removed repositories are pruned.
- **Credentials**: the server's token or SSH key is decrypted (`KINTSUGI_SECRET_KEY`) for one git call and never written to the mirror.

pg-boss keeps its tables in its own `pgboss` schema: an infrastructure library, not one of the domain schemas.

## Document repo writer (implemented)

The only component that commits to a project's document repo (ADR-0019):

- **Queue**: `document-write`, `singleton` policy with `singletonKey` = document repository id: one write per repository at a time, the rest wait. Producers use `@kintsugi/orchestrator/queues` (`sendDocumentWrite`), which also holds the payload type `DocumentWriteRequest`: `writeId`, `projectId`, `kind`, `message`, `files` (path + content, `utf8` or `base64`) or `outputOfJob` (a job id: its `<data>/jobs/<job-id>/out`), and provenance `actor`, `jobId`, `agent`, `unit`.
- **Target**: the project's repository with role `document` only, with its server's credential (decrypted per call, never logged).
- **Output rules**: relative paths, no `..`, `.`, empty or `.git` segments, no symbolic links; at most 500 files, 5 MiB per file, 50 MiB per write. A violation fails the write without a retry.
- **Split**: paths matching `autoCommitPaths` of `kintsugi.yaml` on the default branch (defaults `units/**`, `tasks/**`, `knowledge/**/generated/**`) are committed to the default branch; the rest go to `kintsugi/<agent-or-actor>/<job-id or write-id>` and a pull request.
- **Commits**: author and committer `kintsugi-bot <KINTSUGI_BOT_EMAIL>`, trailers `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Actor`, `Kintsugi-Unit` as provided. Pushes are fast-forward only; a rejection triggers fetch → rebase → retry (4 attempts); a rebase conflict fails the write. Never force-pushes; only the default branch and `kintsugi/*` are writable.
- **Pull requests**: GitHub, GitHub Enterprise, GitLab, Gitea and Azure DevOps through `packages/git` REST adapters with the server token. `plain-git` servers, servers authenticated by SSH key and Bitbucket (no adapter yet) keep the pushed branch (status `committed`).
- **Outcome**: `workflow.document_write` (`queued` → `committed`, `pr-opened`, `unchanged` or `failed` with a redacted error), shown on the project page.

## Planned

- **Job worktrees**: a per-job worktree at the job's commit, mounted read-only as `/src`.
- **Secret scan** of job output before it is written.
- Runtime jobs (via the launcher in `services/runtime`), ingestion, webhooks (D30).

## Run

- Development: `make worker` (or `make dev` for everything); reads the root `.env`.
- Requires `git` 2.40+ on the host or in the image (checked at startup).
