# ADR-0056: A debug MCP server for development installations

- Status: Accepted
- Date: 2026-10-22
- Decision register: D72

## Context

A run that fails on a server is debugged from what a person pastes: a screenshot of the portal, a piece of a log, a copied error. The portal shows a run (steps, attempts, a live log), but not what is in the job's workspace, why a retry did or did not reuse a step, what the worker and the API wrote to their logs while the run was going, whether the queue is stuck or the worker is up, or what the database holds. An agent that could read those directly could find an issue end to end without anyone relaying it.

The pieces exist but are scattered: the run and its events and spans are in Postgres, the workspace of a job ([ADR-0055](0055-one-durable-workspace-per-job.md)) is on the data volume that the API container mounts read-only, the queue is pg-boss tables, and the process logs go to the containers' standard output, where only someone with shell access sees them.

This is a development aid. A production installation must not expose the content of workspaces (the legacy code), the logs, or a query tool.

## Decision

**1. A debug MCP server, off unless the installation says it is a development one.** `KINTSUGI_DEBUG_MCP=1` in the environment of `kintsugi-app` and `kintsugi-worker` turns it on. Without it the route does not exist (404), nothing is captured, and the Compose starter does not set it. The repository's deploy workflow, which deploys the development server, sets it in that server's `.env` on every deploy. It is not tied to `NODE_ENV`: a development server runs the production images.

**2. Transport and authentication.** Streamable HTTP, JSON replies, at `POST /api/debug/mcp`. The caller authenticates with an account of the installation: `Authorization: Basic <base64 username:password>`, checked like a sign-in (same lockout), and the account must hold the new permission `debug.access`, which only the `admin` role has. Every call is audited (`debug.call`: the tool and its arguments, never a result). A request with an `Authorization` header of any scheme passes the CSRF check, as a bearer one does: a browser cannot attach it across sites without a preflight the API never grants.

**3. Read-only tools, grouped by what a person would check first.** All answers are JSON text, bounded in size.

| Group | Tools | What they answer |
|---|---|---|
| Runs | `runs.list`, `runs.get`, `runs.step`, `runs.events`, `runs.failure`, `runs.telemetry`, `runs.ledger` | What ran, how each step ended, the events of one attempt, the first failure with the lines before it, the model usage per step, and which steps the last attempt skipped or ran |
| Sandbox | `workspace.jobs`, `workspace.tree`, `workspace.read` | Which job workspaces are on disk and in what state, what is in one (checkouts, `out/`, `work/`, the steps' folders, the manifest, the ledger) and the text of a file in it |
| Logs | `logs.tail`, `logs.search` | The lines the API and the worker wrote, by service, level and time, with a search and the lines around a hit |
| System | `system.status`, `queues.list`, `repos.status` | The build and uptime, the workers' heartbeats, the runs by status, the queues by state with the last failures, each repository's sync state, the disk the data directory is on |
| Database | `db.tables`, `db.query` | The tables and their columns; one read-only `select` with a time and a row limit |

**4. The logs are captured into the database.** The API and the worker mirror their standard output and error, line by line, into `monitoring.debug_log` (service, level, message), redacted of credentials, when debugging is on. The table is the one place both processes, in separate containers, can write and the API can read, and it needs no change to the volumes (the API mounts the data directory read-only). The writer batches, never fails the process that logs, and keeps one day and 200 000 lines. A run's own log is not duplicated: its events are in `workflow.job_event`.

**5. What the tools may read.** The workspace tools read only under `<data>/jobs/<job id>/`, refuse a path that leaves it (and a link out of it), and cap a file at 100 kB per call. `db.query` runs one statement in a read-only transaction with a five-second limit, only `select` and `with`, and refuses the tables that hold encrypted secrets and the functions that read the server's files. Restricted records of a run are not on disk and not offered.

## Consequences

- An agent given the administrator's credentials of a development server can follow a failure from the portal's status to the line of the worker's log and the file in the workspace that caused it, with no one relaying it. This is the point.
- On a development server the legacy code and the logs are readable through one authenticated route; that is why it is off by default and in the Compose starter, why only the deploy workflow of the development server sets it, and why the account is an administrator's.
- The capture adds a database write per second at most and a table that is pruned by the writers; with the flag off there is nothing.
- `db.query` is powerful. It is as safe as the read-only transaction and the deny list; it is for a development database.
- Not covered: the stdout of the agent child processes (their events and spans are in the run), the host's and the containers' own logs, and metrics over time. A person with shell access has those.

## Alternatives considered

- **Files on the data volume for the logs.** The API mounts the volume read-only and could not write its own; the worker would write and the API read, and the API's own log would need another path. One table does both.
- **The official MCP SDK.** Another dependency for a server that answers four methods with JSON; the repository's own MCP test server does the same by hand.
- **A session cookie or bearer for the caller.** Neither is something an MCP client can obtain without the portal; a sign-in over Basic is what "use the admin account" means.
- **Always on, with a permission.** The workspace holds a customer's code and the logs hold what the services print; a production installation should not have the route at all.
