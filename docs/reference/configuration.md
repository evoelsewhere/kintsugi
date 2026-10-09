# Configuration

Installation-level settings come from `.env` ([`deploy/compose/.env.example`](../../deploy/compose/.env.example)).
- **Configured in the portal**, not in `.env`: Git servers, repositories, LLM providers, users and projects.
- **Configured per project** in the [workspace repo](workspace-repo.md) (`kintsugi.yaml`).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KINTSUGI_VERSION` | no | `latest` | Image tag for `kintsugi-app`, `kintsugi-worker`, `kintsugi-runner` |
| `KINTSUGI_REGISTRY` | no | `registry.example.com/kintsugi` | Container registry hosting the images (use a local registry for air-gapped installs) |
| `KINTSUGI_HTTP_PORT` | no | `8080` | Published port of `kintsugi-app` |
| `KINTSUGI_PUBLIC_URL` | yes | — | External URL (used for links, MCP and CLI configuration) |
| `KINTSUGI_SECRET_KEY` | yes | — | Master key encrypting secrets in Postgres (`openssl rand -base64 32`) |
| `KINTSUGI_BOOTSTRAP_ADMIN_USER` | yes (first start) | `admin` | First admin account |
| `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` | yes (first start) | — | First admin password; change it after first sign-in |
| `POSTGRES_PASSWORD` | yes | — | Password of the `kintsugi` database user |
| `KINTSUGI_GIT_POLL_INTERVAL` | no | `180` | Seconds between Git polls (when webhooks are not used) |
| `KINTSUGI_JOB_MAX_CONCURRENCY` | no | `2` | Parallel runtime jobs |
| `KINTSUGI_JOB_DEFAULT_TIMEOUT` | no | `1800` | Default job timeout (seconds) |
| `KINTSUGI_JOB_MEMORY` | no | `4g` | Memory limit per runner container |
| `KINTSUGI_JOB_CPUS` | no | `2` | CPU limit per runner container |
| `KINTSUGI_JOB_DOCKER_RUNTIME` | no | empty | Set to `runsc` when gVisor is installed |

## Internal (set by the compose file)

| Variable | Container | Description |
|---|---|---|
| `DATABASE_URL` | app, worker | Postgres connection string |
| `DOCKER_HOST` | worker | Restricted Docker API (`docker-proxy`) |
| `KINTSUGI_RUNNER_IMAGE` | worker | Runner image to start per job |
| `KINTSUGI_JOBS_NETWORK` | worker | Network runner containers join |
| `KINTSUGI_JOBS_VOLUME` | worker | Volume holding per-job `/src` and `/out` |
