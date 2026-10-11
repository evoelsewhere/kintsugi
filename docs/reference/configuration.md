# Configuration

Installation-level settings come from `.env` ([`deploy/compose/.env.example`](../../deploy/compose/.env.example)).
- **Configured in the portal**, not in `.env`: Git servers, repositories, the commit identity of `kintsugi-bot` (Settings → Git), LLM providers, users and projects.
- **Configured per project** in the [document repo](document-repo.md) (`kintsugi.yaml`).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KINTSUGI_VERSION` | no | `latest` | Image tag for `kintsugi-app` and `kintsugi-worker` |
| `KINTSUGI_REGISTRY` | no | `registry.example.com/kintsugi` | Container registry hosting the images (use a local registry for air-gapped installs) |
| `KINTSUGI_HTTP_PORT` | no | `8080` | Published port of `kintsugi-app` |
| `KINTSUGI_PUBLIC_URL` | yes | — | External URL (used for links, MCP and CLI configuration) |
| `KINTSUGI_SECRET_KEY` | yes | — | Master key encrypting secrets in Postgres (`openssl rand -base64 32`) |
| `KINTSUGI_BOOTSTRAP_ADMIN_USER` | yes (first start) | `admin` | First admin account |
| `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` | yes (first start) | — | First admin password, at least 8 characters; startup fails without it while the installation has no users. Change it after first sign-in |
| `POSTGRES_PASSWORD` | yes | — | Password of the `kintsugi` database user |
| `KINTSUGI_DATA_DIR` | yes | — | Host directory for Git mirrors, document repo clones and per-job checkouts ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)); size it for every registered repository plus running jobs. Without Docker (development) it defaults to `./.kintsugi/data` |
| `KINTSUGI_GIT_POLL_INTERVAL` | no | `180` | Seconds between full Git re-syncs of every repository (minimum 30); new repositories are cloned within seconds |
| `KINTSUGI_JOB_MAX_CONCURRENCY` | no | `2` | Parallel job runs per worker |
| `KINTSUGI_JOB_DEFAULT_TIMEOUT` | no | `1800` | Wall-clock limit of an agent job (seconds) |
| `KINTSUGI_SCRIPT_TIMEOUT` | no | `600` | Wall-clock limit of a script step (seconds); the process tree is killed when it is exceeded |
| `KINTSUGI_JOB_MAX_OUTPUT_BYTES` | no | `52428800` | Bytes a step may write to its output directory; a script that exceeds it is killed |
| `KINTSUGI_JOB_MAX_TURNS` | no | `80` | Assistant turns per agent job |
| `KINTSUGI_JOB_MAX_COST_USD` | no | unset | Cost limit per agent job (USD); unset = no limit |
| `KINTSUGI_JOB_RETENTION_DAYS` | no | `7` | Days the output directory of a failed or cancelled run, or of a run whose document write failed, is kept under `KINTSUGI_DATA_DIR/jobs/` for inspection and retries. Outputs whose document write is committed, opened as a pull request or unchanged are deleted at once; the worker sweeps expired ones hourly |
| `KINTSUGI_WORKFLOW_MAX_AGENTS` | no | `50` | Agent jobs one workflow may start |
| `KINTSUGI_WORKFLOW_CONCURRENCY` | no | `4` | Agent jobs of one workflow running at a time |
| `KINTSUGI_STAGE_MAX_AGENTS` | no | `200` | Agent jobs one stage run may start, workflow jobs included (a workflow in a stage gets the smaller of what is left and `KINTSUGI_WORKFLOW_MAX_AGENTS`) |
| `KINTSUGI_STAGE_CONCURRENCY` | no | `4` | Steps of one parallel or per-item group of a stage running at a time |
| `KINTSUGI_RUNTIME_MODE` | no | `pi` | `pi` runs agent jobs with the configured LLM providers; `mock` runs them without an LLM (development and demos) |
| `KINTSUGI_PYTHON` | no | `python3` (`python` on Windows) | Python 3.12 interpreter for script steps and hooks |
| `KINTSUGI_NODE` | no | the worker's Node | Node 22+ interpreter for `.js` script steps |

Runtime jobs run in job workspaces under `KINTSUGI_DATA_DIR/jobs/` without an OS-level sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): run the worker as an unprivileged user (never root) whose only writable location is its data directory. Memory and CPU are bounded by the worker container, not per job.

Harness renderers and transformer plugins are configured in the portal (Admin → Harnesses). Runtime agents (built-in and custom) are managed in the Agent Builder and supplied per job ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)). The model binding per agent id is configured in the portal (Admin → LLM Providers).

## Internal (set by the compose file)

| Variable | Container | Description |
|---|---|---|
| `DATABASE_URL` | app, worker | Postgres connection string |
