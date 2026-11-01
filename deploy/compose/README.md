# deploy/compose — self-hosted package

The Docker Compose package for one Kintsugi installation. The app and worker images are built from the repository and published to GHCR by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

| File | Purpose |
|---|---|
| `docker-compose.yml` | Services: `app`, `worker`, `postgres`, and `db-roles`, a one-shot step that runs as the bootstrap superuser on every start and makes the app's role `kintsugi_app` (no superuser) own the database |
| `docker-compose.isolated.yml` | Override that runs job processes as a user of their own ([ADR-0093](../../docs/decisions/0093-job-processes-run-as-a-separate-user.md)) |
| `probe-job-isolation.sh` | Checks on this host that a job process cannot read the worker's secrets |
| `.env.example` | Template used to create a private `.env` on first deployment — see the [configuration reference](../../docs/reference/configuration.md) |

The app and worker images are defined by [`Dockerfile.app`](../../Dockerfile.app) and [`Dockerfile.worker`](../../Dockerfile.worker). On first deploy, the workflow creates `.env` from GitHub Actions variables and secrets, generates any unset secrets on the host, and sets the file mode to `600`. It preserves stored secrets on later deployments and updates configured URL/bind/port variables plus the workflow-managed `KINTSUGI_REGISTRY` and `KINTSUGI_VERSION`.

Runtime jobs run inside `worker`, each in its own job workspace under the data directory ([ADR-0029](../../docs/decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): no Docker socket, no per-job container and no OS-level sandbox. The worker image therefore carries the standard script environment (git 2.40+, Python 3.12 and Node 22 with their standard libraries only) and runs as a non-root user. Jobs are not network-isolated. By default a job process runs as the worker's user, so it can read the worker's environment, which holds `DATABASE_URL` and `KINTSUGI_SECRET_KEY`, and the worker logs a warning saying so when it starts. With `KINTSUGI_JOB_UID` and `KINTSUGI_JOB_GID` set (the image has the user `kintsugi-job`, 10002), every script step, hook and agent job runs as that user instead, which cannot read the worker's environment ([ADR-0093](../../docs/decisions/0093-job-processes-run-as-a-separate-user.md)); the worker then runs as root with only the capabilities it needs to switch users. `docker-compose.isolated.yml` sets all of it; it is not the default until it has been tried on a Linux host. On Windows, macOS and a development machine, jobs run as the worker's user and are not isolated from its secrets. Wherever the legacy code is not trusted, attach the worker to a network that reaches only Postgres, the Git servers and the LLM providers ([Security](../../docs/architecture/concepts/security.md)).

- Install using the published app and worker images: [Docker image guide](../../docs/guides/docker-images.md)
- Build and deploy your own images through GitHub Actions: [installation guide](../../docs/guides/installation.md)
- How it fits together: [deployment view](../../docs/architecture/07-deployment-view.md)

## Job isolation

Start the package with the override, then run the probe on the same host:

```bash
docker compose -f docker-compose.yml -f docker-compose.isolated.yml up -d
./probe-job-isolation.sh
```

The probe starts the worker image with a random marker secret in its environment, runs a script step and a shell child as the job user the way jobs run, and passes only when neither can read the worker's environment (`/proc/<pid>/environ`) and neither has a worker secret in its own. Exit codes: `0` isolated, `1` exposed (a job can read the worker's secrets: do not run untrusted code), `2` Docker is not available, `3` not verified (the worker is not set up for it, or the probe did not run). The boundary is not verified on a host until the probe has passed there. Keep `-f docker-compose.isolated.yml` in every later `docker compose` command, or the worker starts without it.
