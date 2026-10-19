# 7. Deployment view

Kintsugi ships as a self-hosted Docker Compose package ([ADR-0006](../decisions/0006-self-hosted-package.md)). One installation runs on one Docker host and serves one organization.

```
Project's Docker host
  kintsugi-app ── API (REST + OpenAPI), portal (static SPA), MCP server + CLI API
       │
       ├── postgres + pgvector
       │
  kintsugi-worker ── pg-boss consumer, Git sync, document repo writer,
                     job runner: job workspaces <data>/jobs/<id>/{src (ro), in (ro), out, tmp}
                     agent kernel (pi, pinned) · scripts: Python 3.12, Node 22
       │
       └──► LLM providers (as configured) · Git servers (many)            Member machines ──► kintsugi-app
```

## 7.1 Containers

| Container | Responsibility | Exposure |
|---|---|---|
| `kintsugi-app` | API, portal (static SPA), MCP server, CLI API | The only published port, behind the project's reverse proxy / TLS |
| `kintsugi-worker` | pg-boss consumer, Git sync & writer, ingestion, runtime jobs in job workspaces ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)) | Outbound to Git servers and LLM providers |
| `postgres` | `pgvector/pgvector:pg16`; the only stateful service | Internal |

There is no per-job container, no Docker socket and no egress proxy: jobs run inside the worker container, each in its own job workspace, without OS-level isolation.

## 7.2 Networks and volumes

| Name | Purpose |
|---|---|
| `backend` network | app, worker, postgres |
| `pg-data` volume | Postgres data (back this up) |
| `kintsugi-data` volume | Backed by the host directory `KINTSUGI_DATA_DIR`: Git mirrors, document repo worktrees and the job workspaces `jobs/<id>/{src,in,out,tmp}` ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md), [ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)) |

## 7.3 Worker image

- Git 2.40+, Python 3.12 and Node 22, standard libraries only; nothing is installed at run time.
- Runs as a non-root user; its only writable location is the data directory.
- Container memory and CPU limits bound all jobs of the worker together.

Details: [security](concepts/security.md).

## 7.4 Host requirements (estimate, D33)

- Linux, Docker Engine 24+, Compose v2.20+. Without Docker (development), the worker runs directly on Windows, macOS or Linux with Git, Python 3.12 and Node 22.
- 4 vCPU, 16 GB RAM, 100 GB disk.
- Outbound access to the configured Git servers and LLM providers.

## 7.5 Operations

| Task | How |
|---|---|
| Install | [Installation guide](../guides/installation.md) |
| Upgrade | Pull new images; database migrations run on app start |
| Build and deploy | GitHub Actions builds commit-tagged app and worker images, pushes them to GHCR, then updates the self-hosted Compose installation over SSH ([ADR-0039](../decisions/0039-github-actions-ghcr-deployment.md)) |
| Backup | Postgres (`pg-data`). Code and documents are in Git; `KINTSUGI_DATA_DIR` and the KB can be rebuilt from Git (except imported repositories) |
| Offline / air-gapped | Image tarballs + local registry (`KINTSUGI_REGISTRY`) |
| Configuration | [Configuration reference](../reference/configuration.md) |
