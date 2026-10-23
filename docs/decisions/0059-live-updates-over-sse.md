# ADR-0059: The portal follows changes over one SSE stream instead of polling

- Status: Accepted
- Date: 2026-10-23
- Decision register: D75

## Context

Only the log of one run came to the portal over Server-Sent Events ([ADR-0010](0010-postgres-only.md) already names
`LISTEN/NOTIFY` → SSE). Everything else was read again on a timer, 3 to 30 seconds a view, and the API's own run stream looked
in the database once a second for every person watching. Many open views meant many requests with nothing new in them, and a
change still took up to a timer to show.

## Decision

**1. The database says what changed.** Migration `026_change_notifications.sql` puts a trigger on the tables people
watch (`job_run`, `job_event`, `document_write`, `git_repository`, `worker_heartbeat`, `gate`, `audit_event`,
`telemetry_span`) that sends `NOTIFY kintsugi_change` with `{ "t": topic, "s": scope }` (a project id, a run id for
`job-events`; never row content). It fires in the transaction that changes the row, so it works the same for the API and the
worker, and nothing has to remember to publish.

**2. The API listens once.** `ChangeFeed` (`common/realtime`) holds one `LISTEN` connection, opens it again with backoff and
tells every listener `resync` after it was away. A run's stream (`GET …/job-runs/:id/events`) waits on it instead of
sleeping a second, and keeps a 30 s safety wait in case a notice was lost; a notice that arrives while it reads is kept, so
none is missed.

**3. The portal has one stream.** `GET /api/events` (a session, no permission: it carries topic names and project ids only,
never data) sends `change` events with what changed since the last one, deduplicated over 400 ms. `lib/live.ts` keeps one
`EventSource` per tab for all views: `useLoader(key, load, { live: ["job-runs:<project>", …] })` reads again when one of its
topics changes (not more than every 1.5 s), waits while the tab is hidden, and reads everything again after a reconnect.
`job-events` is not a topic of this stream (one per log line): a run's own stream carries those.

**3a.** The timeline of a running run in Monitoring reads again when that run's stream reports a step or a status
(`useRunPulse`), not on a timer.

## Consequences

- Views show a change within about a second and make no request while nothing changes; the number of requests no longer
  grows with the number of open views.
- A timer is left in two places because there is no change to be notified of: the worker status (a worker that stops
  changes nothing in the database, so those views also read every 30 s) and the sandbox folders (on disk).
- Each change to a watched table costs one `pg_notify`; `telemetry_span` and `job_event` are the busy ones, and the
  portal side throttles what they cause.
- A new watched view names its topics in `live`; a new table adds a trigger in a migration.

## Not done

- The worker's own loops (the scan for repositories to clone every 5 s, the cancel check every 2 s) still look in the
  database; pg-boss polls its queues as well. They could wake on the same notices.
- Topic filters per connection: every stream gets all the topics above (they are small).
