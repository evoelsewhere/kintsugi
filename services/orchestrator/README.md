# services/orchestrator

Runs inside `kintsugi-worker`. Postgres-backed job queue (pg-boss, ADR-0003), Git sync, the document repo writer, runtime job runs in job workspaces and, later, the pipeline/stage/gate state machine.

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
- **Commits**: author and committer the commit identity set in the portal (default `kintsugi-bot <kintsugi-bot@kintsugi.invalid>`), read per write, trailers `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Actor`, `Kintsugi-Unit` as provided. Pushes are fast-forward only; a rejection triggers fetch → rebase → retry (4 attempts); a rebase conflict fails the write. Never force-pushes; only the default branch and `kintsugi/*` are writable.
- **Pull requests**: GitHub, GitHub Enterprise, GitLab, Gitea and Azure DevOps through `packages/git` REST adapters with the server token. `plain-git` servers, servers authenticated by SSH key and Bitbucket (no adapter yet) keep the pushed branch (status `committed`).
- **Outcome**: `workflow.document_write` (`queued` → `committed`, `pr-opened`, `unchanged` or `failed` with a redacted error), shown on the project page.

## Runtime job runs (implemented)

Runs stages, script steps, agent jobs and workflows in job workspaces ([ADR-0029](../../docs/decisions/0029-job-workspaces-instead-of-os-sandboxes.md)), recorded in `workflow.job_run` (migration `010_job_runs.sql`):

- **Queue**: `job-run` (payload `{ jobRunId }`, contract in `@kintsugi/orchestrator/queues`), not retried; `KINTSUGI_JOB_MAX_CONCURRENCY` runs per worker. The API creates the row as `queued`.
- **Workspace** (`src/jobs/runner.ts`): `<data>/jobs/<id>/src` is a detached worktree of the source repository's mirror at the commit of its default branch (recorded on the run), marked read-only; `in` holds the step's inputs (earlier steps' outputs, declared document-repo files), read-only; `out` and `tmp` are writable; `src`, `in` and `tmp` are removed when the run ends.
- **Stages** (`src/jobs/stages.ts`): ordered steps run as child runs sharing the stage's checkout. First milestone: `assess` = script `inventory.py` → agent `legacy-analyst` writing `assessment/<app>/inventory.json` and the `ASSESSMENT.md` draft.
- **Script steps**: built-in `packages/agents/builtin/scripts/<name>` or a model-written script among the inputs (`scriptFromInputs`), through `@kintsugi/runtime/launcher` (cleared environment, timeout, output cap, process-tree kill, sha256 recorded).
- **Agent jobs**: the built-in agent definition (`@kintsugi/agents`) and the agent's model binding (`admin.agent_model_binding`, project first) in a `JobSpec`, run as a child process per job (`createChildAgentRuntime` from `@kintsugi/runtime/launcher`): pi, or the mock backend (`KINTSUGI_RUNTIME_MODE=mock`). The provider's credentials go to that child only (stdin and its environment). The kernel confines reads to `src` and `in`, writes to `out`.
- **Workflows** (`src/jobs/workflow.ts`): `builtin/workflows/<id>.js` only, evaluated with injected `args`, `log`, `agent`, `parallel`, `pipeline`, `phase`, `budget`; each `agent()` is a child agent run; agent cap and concurrency from `KINTSUGI_WORKFLOW_*`.
- **After every step**: `out/restricted/` → `governance.restricted_record` (encrypted) and removed; the JobOutput hook (`hooks/job_output.py`) over `out/`, fail-closed, with a reason from its redacted report; `workflow.artifact` rows with provenance.
- **Hand-off**: a top-level run with output enqueues a `document-write` with `outputOfJob` = the run (its `out/`), `jobId`, `agent`, `actor`, and records `document_write_id`.
- **Live events and cancel**: status, steps, agent tool calls (tool and path only) and log lines go to `workflow.job_event`, redacted; cancel requests (`cancel_requested_at`) are polled every 2 seconds and abort the run (processes killed, run `cancelled`).
- **Cleanup** (`src/jobs/cleanup.ts`): `out/` is deleted once its write is `committed`, `pr-opened` or `unchanged`; failed runs and writes keep it for `KINTSUGI_JOB_RETENTION_DAYS`; an hourly sweep removes expired workspaces.
- **Gates** (`src/gates.ts`, database only): `requestGate()` opens a pending `governance.gate` (or returns the one already pending for the same project, application, key and subject) and audits it as `gate.request`; `gateState()` reads it; `waitForGate()` polls until a person approves, rejects or waives it (abortable). For stage plans that stop at a gate.
- More stages (the full assess plan, map, extract-rules, …) and workflows per application source.
- Ingestion, webhooks (D30).

## Heartbeat (implemented)

`src/heartbeat.ts` ([ADR-0030](../../docs/decisions/0030-worker-heartbeat-in-postgres.md)): every 15 seconds the worker upserts its row in `workflow.worker_heartbeat` (random id per process, host, pid, version from `KINTSUGI_VERSION` or the package, active jobs across all queues, the queues it works); on shutdown it marks the row stopped after the queues stop. A failed beat is logged, never fatal. Rows unseen for 7 days are removed on start.

## Run

- Development: `make worker` (or `make dev` for everything); reads the root `.env`.
- Requires `git` 2.40+ (checked at startup), Python 3.12 (`KINTSUGI_PYTHON`) and Node 22 on the host or in the image. Works the same on Windows, macOS and Linux.
