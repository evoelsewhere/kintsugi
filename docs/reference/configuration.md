# Configuration

Installation-level settings come from `.env` ([`deploy/compose/.env.example`](../../deploy/compose/.env.example)).
- **Configured in the portal**, not in `.env`: Git servers, repositories, LLM providers, users and projects.
- **Configured per project** in the [document repo](document-repo.md) (`kintsugi.yaml`).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KINTSUGI_VERSION` | no | `latest` | Image tag for `kintsugi-app`, `kintsugi-worker`, `kintsugi-runner` |
| `KINTSUGI_REGISTRY` | no | `registry.example.com/kintsugi` | Container registry hosting the images (use a local registry for air-gapped installs) |
| `KINTSUGI_HTTP_PORT` | no | `8080` | Published port of `kintsugi-app` |
| `KINTSUGI_PUBLIC_URL` | yes | — | External URL (used for links, MCP and CLI configuration) |
| `KINTSUGI_SECRET_KEY` | yes | — | Master key encrypting secrets in Postgres (`openssl rand -base64 32`) |
| `KINTSUGI_BOOTSTRAP_ADMIN_USER` | yes (first start) | `admin` | First admin account |
| `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` | yes (first start) | — | First admin password, at least 8 characters; startup fails without it while the installation has no users. Change it after first sign-in |
| `POSTGRES_PASSWORD` | yes | — | Password of the `kintsugi` database user |
| `KINTSUGI_DATA_DIR` | yes | — | Host directory for Git mirrors, document repo clones and per-job checkouts ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)); size it for every registered repository plus running jobs. Without Docker (development) it defaults to `./.kintsugi/data` |
| `KINTSUGI_GIT_POLL_INTERVAL` | no | `180` | Seconds between full Git re-syncs of every repository (minimum 30); new repositories are cloned within seconds |
| `KINTSUGI_BOT_EMAIL` | no | `kintsugi-bot@kintsugi.invalid` | Author and committer email of `kintsugi-bot`, the identity of every commit the worker makes to a document repo ([ADR-0019](../decisions/0019-workspace-repo-write-path.md)). Set an address the Git server maps to the bot account to link commits to it |
| `KINTSUGI_JOB_MAX_CONCURRENCY` | no | `2` | Parallel runtime jobs |
| `KINTSUGI_JOB_DEFAULT_TIMEOUT` | no | `1800` | Default job timeout (seconds) |
| `KINTSUGI_JOB_MEMORY` | no | `4g` | Memory limit per runner container |
| `KINTSUGI_JOB_CPUS` | no | `2` | CPU limit per runner container |
| `KINTSUGI_JOB_DOCKER_RUNTIME` | no | empty | Set to `runsc` when gVisor is installed |

Harness renderers and transformer plugins are configured in the portal (Admin → Harnesses). Runtime agents (built-in and custom) are managed in the Agent Builder and supplied per job ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)). The model binding per agent id is configured in the portal (Admin → LLM Providers).

## Internal (set by the compose file)

| Variable | Container | Description |
|---|---|---|
| `DATABASE_URL` | app, worker | Postgres connection string |
| `DOCKER_HOST` | worker | Restricted Docker API (`docker-proxy`) |
| `KINTSUGI_RUNNER_IMAGE` | worker | Runner image to start per job |
| `KINTSUGI_JOBS_NETWORK` | worker | Network runner containers join |
| `KINTSUGI_DATA_VOLUME` | worker | The `kintsugi-data` volume; runner containers get its `jobs/<job-id>/src` (read-only) and `jobs/<job-id>/out` subpaths |
