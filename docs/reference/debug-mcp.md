# Debug MCP server

A development installation can serve a read-only MCP server that lets an agent follow a run from the portal's status to the line of a log and the file in the job's sandbox that caused it ([ADR-0056](../decisions/0056-debug-mcp-for-development-installations.md)). **It is off unless the installation says it is a development one**: set `KINTSUGI_DEBUG_MCP=1` in the environment of `kintsugi-app` **and** `kintsugi-worker`. Without it the route answers 404, nothing is captured, and the Compose starter does not set it (the repository's deploy workflow sets it for the development server it deploys to). Never set it on a production installation: the tools read the legacy code in the workspaces, the logs and the database.

## Connecting

- **URL**: `POST <public url>/api/debug/mcp` (Streamable HTTP, JSON replies, no sessions, no streaming).
- **Authentication**: `Authorization: Basic base64(username:password)` on every request. The account must hold the permission `debug.access`, which the `admin` role has; the check is a sign-in's (the same lockout after failures, no session created). Every tool call is audited as `debug.call` with its arguments, never its result.

```bash
claude mcp add --transport http kintsugi-debug https://<server>/api/debug/mcp \
  --header "Authorization: Basic $(printf 'admin:<password>' | base64)"
```

## Tools

All read; each answer is JSON text, cut at 60 000 characters.

| Tool | Answers |
|---|---|
| `system.status` | Start here. The API (build, uptime, memory), the database (size, connections, migrations), each worker's heartbeat and whether it is up, the runs by status, the repositories by sync status, the data volume, what the log capture holds |
| `runs.list` | The latest top-level runs, newest first (filter by project, application, status) |
| `runs.failure` | A failed run: the failed steps with reasons, the last events of the latest attempt, the events that mention a failure or a blocked call, and the warnings and errors the services logged while it ran |
| `runs.get` | A run with its steps (agent, usage, failure), attempts, sources, document write, artifacts and inputs |
| `runs.step` | One step: the inputs it ran with (the agent's task included) and the summary it recorded |
| `runs.events` | The run's live record, paged with `cursor`; filter by kind, step, attempt, text; `order: desc` for the end of a long run |
| `runs.telemetry` | Model usage per step and attempt (turns, tool calls, retries, errors, time) and the spans that ended in an error |
| `runs.ledger` | From the job's workspace: the ledger entries (status, attempt, fingerprint, files written), the gate choices, the manifest and the step folders on disk: which steps the latest attempt skipped or ran, and when each last ran |
| `workspace.jobs` | The job workspaces on the data volume, newest first, with their run status and manifest |
| `workspace.tree` | The files of a workspace (`as-is/`, `to-be/`, `docs/`, `out/`, `work/`, `steps/<step>/`, `.state/`) to a depth |
| `workspace.read` | The text of a file in a workspace, 100 kB per call (`offset` to read on); a binary file says so |
| `logs.tail` | The latest lines the API and the worker printed, with what was captured per service |
| `logs.search` | A regular expression over the captured lines, by service, level and time, with `context` lines around each hit |
| `queues.list` | The worker's pg-boss queues (queued, active, deferred) and the latest failed or retried jobs with their error output |
| `repos.status` | Each Git repository's sync status, last commit and last error |
| `db.tables` | The tables with an estimate of their rows; with `schema` and `table`, their columns |
| `db.query` | One `select` or `with` statement: read-only transaction, five seconds, 200 rows at most, long values cut |

## Limits

- The workspace tools read only under `<data>/jobs/<job id>/`; a path that leaves it, by name or through a link, is refused.
- `db.query` refuses anything but one select or with statement, the tables that hold secrets, sessions and encrypted credentials, and the functions that read the server's files. It is as safe as the read-only transaction: use a development database.
- Restricted records are not on disk and not offered.
- The logs are captured from the standard output and error of the API and the worker (redacted of credentials), kept one day and 200 000 lines in `monitoring.debug_log`. Not covered: the output of the agent child processes (a run's events and spans have it), and the host's and the containers' own logs.
