# Kintsugi GHCR and SSH deployment

## Intent

Deploy the Kintsugi Docker Compose package to the user's Linux host from GitHub Actions after changes land on `master`.

## Goals

- Build the `kintsugi-app` and `kintsugi-worker` images from the monorepo.
- Publish commit-tagged images to GHCR.
- Connect to the configured host over SSH and update its Compose project to the exact commit tag.
- Keep the Compose topology at app, worker, and Postgres; preserve the configurable registry interface.
- Use GitHub Actions secrets for SSH and registry credentials and pin the host key.

## Constraints

- The app image serves both the API and the Vite portal, matching ADR-0017 and the deployment view.
- The worker image provides Node 22, Python 3.12, and Git, and runs without root.
- Runtime data remains on the host at `KINTSUGI_DATA_DIR`; the worker owns writes, and the app mounts it read-only.
- GitHub Actions deploys on pushes to `master` and supports a manual run from `master`.
- No credential values are committed or printed. First-time host provisioning remains an operator step because database/bootstrap values are installation-specific.

## Configuration shape

Repository variables: `SSH_HOST`, `SSH_USER`, optional `SSH_PORT` (default 22), and `KINTSUGI_REMOTE_DIR`.

Repository secrets: `SSH_PASSWORD`, `SSH_KNOWN_HOSTS`, and `GHCR_PULL_TOKEN`. The registry token must be a classic GitHub token with `read:packages`; the workflow's built-in token publishes images.

## Non-goals

- Installing Docker or configuring the host firewall, DNS, TLS, or reverse proxy.
- Creating the host's first `.env` or choosing its bootstrap/database secrets.
- Changing the documented single-host Compose architecture.
