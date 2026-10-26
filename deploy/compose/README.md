# deploy/compose — self-hosted package

The Docker Compose package for one Kintsugi installation. The app and worker images are built from the repository and published to GHCR by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

| File | Purpose |
|---|---|
| `docker-compose.yml` | Services: `app`, `worker`, `postgres` |
| `.env.example` | Template used to create a private `.env` on first deployment — see the [configuration reference](../../docs/reference/configuration.md) |

The app and worker images are defined by [`Dockerfile.app`](../../Dockerfile.app) and [`Dockerfile.worker`](../../Dockerfile.worker). On first deploy, the workflow creates `.env` from GitHub Actions variables and secrets, generates any unset secrets on the host, and sets the file mode to `600`. It preserves stored secrets on later deployments and updates configured URL/bind/port variables plus the workflow-managed `KINTSUGI_REGISTRY` and `KINTSUGI_VERSION`.

Runtime jobs run inside `worker`, each in its own job workspace under the data directory ([ADR-0029](../../docs/decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): no Docker socket, no per-job container and no OS-level sandbox. The worker image therefore carries the standard script environment (git 2.40+, Python 3.12 and Node 22 with their standard libraries only) and runs as a non-root user. Jobs are not network-isolated: to restrict egress, attach the worker to a network that reaches only Postgres, the Git servers and the LLM providers.

- Install using the published app and worker images: [Docker image guide](../../docs/guides/docker-images.md)
- Build and deploy your own images through GitHub Actions: [installation guide](../../docs/guides/installation.md)
- How it fits together: [deployment view](../../docs/architecture/07-deployment-view.md)
