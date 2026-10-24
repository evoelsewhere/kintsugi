# Configuration

Installation-level settings come from `.env` ([`deploy/compose/.env.example`](../../deploy/compose/.env.example)).
- **Configured in the portal**, not in `.env`: Git servers, repositories, the commit identity of `kintsugi-bot` (Settings → Git), the sandbox environment jobs run in ([below](#the-sandbox-environment)), LLM providers, users and projects.
- **Configured per project** in the [document repo](document-repo.md) (`kintsugi.yaml`).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KINTSUGI_VERSION` | no | `latest` | Image tag for `kintsugi-app` and `kintsugi-worker`; the worker also reports it in its heartbeat (Monitoring → Worker, [ADR-0030](../decisions/0030-worker-heartbeat-in-postgres.md)), falling back to its package version when unset |
| `KINTSUGI_REGISTRY` | no | `ghcr.io/evoelsewhere` | Container registry namespace hosting `kintsugi-app` and `kintsugi-worker` (use a local registry for air-gapped installs) |
| `KINTSUGI_HTTP_BIND` | no | `127.0.0.1` | Host interface for the published app port. Loopback keeps the app private for SSH-tunnel access or a local TLS reverse proxy |
| `KINTSUGI_HTTP_PORT` | no | `8080` | Published port of `kintsugi-app` |
| `KINTSUGI_PUBLIC_URL` | yes | `http://localhost:8080` in the Compose starter | External URL (used for links, MCP and CLI configuration); use the HTTPS URL when publishing behind a TLS reverse proxy |
| `KINTSUGI_RELEASES_DIR` | no | `/app/releases` in the image | Folder of CLI packages the app serves at `/api/v1/releases` and lists in the Guideline ([ADR-0070](../decisions/0070-cli-distributed-by-the-installation.md)); the image build fills it |
| `KINTSUGI_SECRET_KEY` | yes | — | Master key encrypting secrets in Postgres (`openssl rand -base64 32`) |
| `KINTSUGI_BOOTSTRAP_ADMIN_USER` | yes (first start) | `admin` | First admin account |
| `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` | yes (first start) | — | First admin password; the deploy workflow accepts letters, digits, dots, underscores, and hyphens (minimum 8 characters). Change it after first sign-in |
| `POSTGRES_PASSWORD` | yes | — | Hexadecimal password of the `kintsugi` database user (minimum 32 characters in the deploy workflow) |
| `KINTSUGI_DATA_DIR` | yes | `<deployment directory>/data` in the first Compose deployment | Host directory for Git mirrors, document repo clones and per-job checkouts ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)); size it for every registered repository plus running jobs. Without Docker (development) it defaults to `./.kintsugi/data`. The API reads the document repo mirrors here (read-only), so it needs the same value as the worker |
| `KINTSUGI_GIT_POLL_INTERVAL` | no | `180` | Seconds between full Git re-syncs of every repository (minimum 30); new repositories are cloned within seconds |
| `KINTSUGI_JOB_MAX_CONCURRENCY` | no | `2` | Parallel job runs per worker |
| `KINTSUGI_TELEMETRY_RETENTION_DAYS` | no | `30` | Days the spans of agent jobs (`monitoring.telemetry_span`) are kept ([ADR-0048](../decisions/0048-runtime-telemetry-compaction-and-prompt-cache.md)) |
| `KINTSUGI_WORKFLOW_CONCURRENCY` | no | `4` | Agent jobs of one workflow running at a time |
| `KINTSUGI_STAGE_MAX_AGENTS` | no | `200` | Agent jobs one stage run may start, workflow jobs included; a workflow in a stage may start what is left of it. A workflow has no limit of its own |
| `KINTSUGI_STAGE_CONCURRENCY` | no | `4` | Steps of one parallel or per-item group of a stage running at a time |
| `KINTSUGI_DEBUG_MCP` | no | unset | `1` on a **development** installation (set it for `kintsugi-app` and `kintsugi-worker`) serves the [debug MCP server](debug-mcp.md) and mirrors the API's and the worker's logs to the database ([ADR-0056](../decisions/0056-debug-mcp-for-development-installations.md)). Never set it in production |
| `KINTSUGI_RUNTIME_MODE` | no | `pi` | `pi` runs agent jobs with the configured LLM providers; `mock` runs them without an LLM (development and demos) |
| `KINTSUGI_PYTHON` | no | `python3` (`python` on Windows) | Python 3.12 interpreter for script steps and hooks |
| `KINTSUGI_NODE` | no | the worker's Node | Node 22+ interpreter for `.js` script steps |

Runtime jobs run in job workspaces under `KINTSUGI_DATA_DIR/jobs/` without an OS-level sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): run the worker as an unprivileged user (never root) whose only writable location is its data directory. Memory and CPU are bounded by the worker container, not per job.

## The sandbox environment

The settings of the environment jobs run in are set by an administrator in **Settings → Sandbox** (permission `sandbox.manage`), stored in `admin.installation_setting` under `sandbox`, and read by the worker when a job starts and in each sweep: a change applies to the next job, without a restart ([ADR-0055](../decisions/0055-one-durable-workspace-per-job.md)). They replace the variables `KINTSUGI_JOB_DEFAULT_TIMEOUT`, `KINTSUGI_AGENT_IDLE_TIMEOUT`, `KINTSUGI_SCRIPT_TIMEOUT`, `KINTSUGI_JOB_MAX_OUTPUT_BYTES`, `KINTSUGI_JOB_MAX_TURNS`, `KINTSUGI_JOB_MAX_COST_USD` and `KINTSUGI_JOB_RETENTION_DAYS`, which the worker no longer reads.

| Setting | Default | Meaning |
|---|---|---|
| Keep the checkouts of a failed job (hours) | `24` | After this long the sweep drops the checkouts and the documents of a failed job; a retry makes them again from the pinned commits. 1 to 720 |
| Keep the results of a failed job (days) | `7` | Days the workspace of a failed or cancelled run, or of a run whose document write failed, is kept for inspection and retries. Outputs whose document write is committed, opened as a pull request, merged, closed or unchanged are deleted at once. 1 to 90 |
| Script timeout (minutes) | `10` | Wall-clock limit of a script step; the process tree is killed when it is exceeded. 10 seconds to 24 hours |
| Agent job timeout (minutes) | `0` | Wall-clock limit of an agent job; `0` = no limit |
| Agent idle limit (minutes) | `5` | No sign of life from the model (text, thinking, tool-call arguments, tool calls) for this long and the job is stopped as stalled and tried once more; `0` turns the watchdog off |
| Output limit (MB) | `50` | What a step may write to its output folder; a script that exceeds it is killed. 1 MB to 10 GB |
| Turns per agent job | `0` | Assistant turns; `0` = no limit |
| Cost per agent job (USD) | `0` | `0` = no limit |
| Mark checkouts and inputs read-only on disk | on | A second line of defence beside the kernel's path guard; switch it off where changing the permissions of thousands of files is slow |

Harness renderers and transformer plugins are configured in the portal (Admin → Harnesses). Runtime agents (built-in and custom) are managed in the Agent Builder and supplied per job ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)). The model binding per agent id is configured in the portal (Admin → LLM Providers).

## Internal (set by the compose file)

| Variable | Container | Description |
|---|---|---|
| `DATABASE_URL` | app, worker | Postgres connection string |
