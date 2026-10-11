# deploy/compose — self-hosted package

> Draft. The images are not published yet (milestone M0).

The Docker Compose package for one Kintsugi installation.

| File | Purpose |
|---|---|
| `docker-compose.yml` | Services: `app`, `worker`, `postgres` |
| `.env.example` | Installation settings — see the [configuration reference](../../docs/reference/configuration.md) |

Runtime jobs run inside `worker`, each in its own job workspace under the data directory ([ADR-0029](../../docs/decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): no Docker socket, no per-job container and no OS-level sandbox. The worker image therefore carries the standard script environment (git 2.40+, Python 3.12 and Node 22 with their standard libraries only) and runs as a non-root user. Jobs are not network-isolated: to restrict egress, attach the worker to a network that reaches only Postgres, the Git servers and the LLM providers.

- How to install, upgrade and back up: [installation guide](../../docs/guides/installation.md)
- How it fits together: [deployment view](../../docs/architecture/07-deployment-view.md)
