# 7. Deployment view

Kintsugi ships as a self-hosted Docker Compose package ([ADR-0006](../decisions/0006-self-hosted-package.md)). One installation runs on one Docker host and serves one organization.

```
┌───────────────────────────── Project's Docker host ─────────────────────────────┐
│                                                                                  │
│  ┌───────────────────────────┐      ┌───────────────────────────────────┐        │
│  │ kintsugi-app              │      │ kintsugi-worker                   │        │
│  │  · API (REST + OpenAPI)   │      │  · pg-boss job consumer           │        │
│  │  · Portal (static SPA)    │      │  · pipeline / stage state machine │        │
│  │  · MCP server + CLI API   │◄────►│  · git sync (clone/fetch/poll)    │        │
│  │  · Job gateway (runner →) │      │  · job launcher (Docker API)      │        │
│  └──────┬──────────▲─────────┘      │  · git writer (commit / PR)       │        │
│         │          │                └───────┬───────────────┬───────────┘        │
│         ▼          │ JobEvent, kb.*         │ docker run    │                    │
│  ┌──────────────┐  │                ┌───────▼───────────────────────────┐        │
│  │ postgres     │  └────────────────┤ kintsugi-runner (1 container/job) │        │
│  │ + pgvector   │                   │  Node + pi SDK (pinned) + ext     │        │
│  └──────────────┘                   │  /src  read-only (git checkout)   │        │
│                                     │  /out  writable (results)         │        │
│  ┌──────────────┐  ┌──────────────┐ └───────┬───────────────────────────┘        │
│  │ docker-proxy │  │ egress-proxy │◄────────┘ only to configured LLM providers   │
│  └──────────────┘  └──────┬───────┘                                              │
└───────────────────────────┼──────────────────────────────────────────────────────┘
                            ▼                       ▲                    ▲
                 LLM providers (as configured)   Git servers (many)   Member machines
```

## 7.1 Containers

| Container | Responsibility | Exposure |
|---|---|---|
| `kintsugi-app` | API, portal (static SPA), MCP server, CLI API, job gateway | The only published port, behind the project's reverse proxy / TLS |
| `kintsugi-worker` | pg-boss consumer, state machine, Git sync & writer, ingestion, job launcher | Outbound to Git servers |
| `kintsugi-runner` | One container per runtime job; Node + pi SDK | Internal `jobs` network only |
| Rulebook runner containers | One per runner execution; image declared by the runner and on `KINTSUGI_JOB_IMAGE_ALLOWLIST` | Network `none` by default |
| `postgres` | `pgvector/pgvector:pg16`; the only stateful service | Internal |
| `docker-proxy` | Restricted Docker API for the worker ❓ D32 | Internal |
| `egress-proxy` | Allowlist of LLM provider hosts; the runner's only route to the internet | Internal + outbound |

## 7.2 Networks and volumes

| Name | Purpose |
|---|---|
| `backend` network | app, worker, postgres, docker-proxy |
| `jobs` network (`internal: true`) | runner containers, app (job gateway), egress-proxy |
| `egress` network | egress-proxy → internet |
| `pg-data` volume | Postgres data (back this up) |
| `kintsugi-data` volume | Backed by the host directory `KINTSUGI_DATA_DIR`: Git mirrors, the workspace clones, per-job `/src` (read-only worktree) and `/out` mounted via volume subpaths ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)) |

## 7.3 Runner container hardening

- non-root user
- `--read-only` root filesystem
- `cap-drop ALL`
- `no-new-privileges`
- CPU, memory and wall-clock limits
- gVisor (`runsc`) when available

Details: [security](concepts/security.md).

## 7.4 Host requirements (estimate, D33)

- Linux, Docker Engine 24+ (26+ for volume subpaths), Compose v2.
- 4 vCPU, 16 GB RAM, 100 GB disk.
- Outbound access to the configured Git servers and LLM providers.

## 7.5 Operations

| Task | How |
|---|---|
| Install | [Installation guide](../guides/installation.md) |
| Upgrade | Pull new images; database migrations run on app start |
| Backup | Postgres (`pg-data`). Code and documents are in Git; `KINTSUGI_DATA_DIR` and the KB can be rebuilt from Git (except imported repositories) |
| Offline / air-gapped | Image tarballs + local registry (`KINTSUGI_REGISTRY`) |
| Configuration | [Configuration reference](../reference/configuration.md) |
