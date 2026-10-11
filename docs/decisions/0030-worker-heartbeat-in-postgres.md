# ADR-0030: Worker heartbeat in Postgres

- Status: Accepted
- Date: 2026-10-12
- Decision register: D49

## Context
The portal must tell whether `kintsugi-worker` is running. Until now it guessed from indirect signals: pg-boss queue counts and how long the oldest queued run had waited. An idle worker and a stopped worker looked the same until a run had been queued for ten minutes, and the portal could not say how many workers ran, where, at which version or what they were doing.

Constraints: Postgres is the only datastore (ADR-0010), the deployment is a Docker Compose package without an orchestrator (ADR-0006), and the API and the worker already share the database. pg-boss keeps its own internal state, but it is not a stable contract and holds no host, version or job information.

Options considered:
1. Keep inferring from queue activity (no change).
2. An HTTP health endpoint on the worker, probed by the API. The worker serves no HTTP today; it would add a port, network rules between containers and discovery of several workers.
3. Read pg-boss internals (its supervisor and worker rows). This couples the API to a library's private tables, which change between versions.
4. Each worker writes its own heartbeat row to Postgres.

## Decision
Each worker process keeps one row in `workflow.worker_heartbeat` (migration 014):

- **Identity**: a random `worker_id` per process, plus `host`, `pid`, `version` (`KINTSUGI_VERSION`, else the package version) and `started_at`.
- **Beat**: the worker upserts its row every **15 seconds** (`last_seen_at = now()`, by the database clock), with `active_jobs` (job runs, document writes and Git syncs in progress) and the `queues` it works. A failed beat is logged and retried at the next tick; it never stops the worker.
- **Shutdown**: after the queues stop gracefully, the worker sets `stopped_at`. A crash leaves the row to go stale.
- **Judgement**: the API reports a worker as **up** when it was seen less than **45 seconds** ago (three missed beats), **stopped** when `stopped_at` is set, and **stale** otherwise. `GET /api/monitoring/workers` lists the rows. The monitoring overview reports `worker.up`, the number of workers up and the latest beat, and adds a `worker-down` attention item when no worker is up.
- **Retention**: a starting worker deletes rows not seen for 7 days.

No new configuration: the interval and threshold are constants (a test-only option shortens the interval).

## Consequences
- The overview and Monitoring → Worker show real worker state immediately: up or not, how many, host, version, active jobs and queues. Queue counts remain as a second signal (for example, "up but not picking up runs").
- The worker writes one small upsert every 15 seconds per process, which is negligible for Postgres.
- Clock skew does not matter: both the beat and the judgement use the database clock.
- A worker that is alive but wedged (its event loop blocked) stops beating and shows as stale, which is the desired signal.
- Several workers are supported naturally; each has its own row.
- Follow-up: alerting (for example a webhook when no worker is up) can build on the same table.

## Alternatives considered (optional)
- **Queue inference** (option 1): rejected; it cannot tell idle from stopped.
- **HTTP probe** (option 2): rejected; it needs a new listening port and worker discovery for little benefit over a database row.
- **pg-boss internals** (option 3): rejected; private tables of a pinned library are not a contract.
