# ADR-0039: Build and deploy the self-hosted package with GitHub Actions

- Status: Accepted
- Date: 2026-10-19
- Decision register: D56

## Context

The Compose package described by ADR-0006 had no buildable app/worker images or deployment automation. Deploying a repository commit must produce the same immutable image versions that the host runs, without placing installation credentials in Git.

## Decision

- Build `kintsugi-app` and `kintsugi-worker` from the monorepo in GitHub Actions and publish them to GHCR, tagged with the source commit SHA.
- On pushes to `master` and manual runs from `master`, deploy only after both images publish successfully. Connect to the configured self-hosted Compose host over SSH, use a pinned host key, and keep the SSH password and GHCR pull token in GitHub Actions secrets.
- Use GHCR as the default registry while retaining `KINTSUGI_REGISTRY` as an installation setting so another registry can be selected.
- Keep the three-container Compose topology. The app image contains the API and portal; the worker image includes Node 22, Python 3.12, and Git and runs as a non-root user.
- Do not overwrite the host `.env`. The workflow updates only the registry and image version after checking that the installation has been initialized.

## Consequences

- A private GHCR package requires a read-only package token for remote pulls; the workflow uses a temporary Docker config and removes it after deployment.
- Initial host provisioning remains manual: Docker/Compose, data-directory ownership, installation secrets, and first-admin credentials are operator-managed.
- Actions run only for `master`, and a build failure prevents deployment. The SSH host key must be verified out of band before it is added to repository secrets.
- The API serves the built portal only when `KINTSUGI_PORTAL_DIR` is configured, so local development keeps its separate Vite server.
