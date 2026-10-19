# GHCR and SSH deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and publish Kintsugi app/worker images to GHCR and deploy the selected commit to the configured Compose host over SSH.

**Architecture:** Two Dockerfiles build the API+portal app and the worker from the pnpm monorepo. A GitHub Actions workflow publishes SHA-tagged images, then synchronizes the Compose bundle and updates the remote installation over password-authenticated SSH with a pinned host key.

**Tech Stack:** Docker, Docker Compose, GitHub Actions, GHCR, OpenSSH, pnpm.

**Spec:** [2026-10-19-ghcr-ssh-deploy-design.md](../specs/2026-10-19-ghcr-ssh-deploy-design.md)

## Global Constraints

- Use Docker Compose with app, worker, and Postgres only.
- Keep credentials out of source and workflow logs.
- Run app and worker as non-root users.
- Keep the app's data mount read-only and the worker's mount writable.
- Deploy immutable commit tags; retain a configurable container registry.

## Review Focus

- Missing or malformed SSH/GHCR configuration must fail before remote changes.
- An untrusted host key must fail closed.
- First deployment without a populated `.env` must stop with setup guidance.
- A failed image build must prevent SSH deployment.
- The worker data directory must be writable by the worker's non-root UID.

---

### Task 1: Container images and app delivery

**Files:** Create `Dockerfile.app`, `Dockerfile.worker`, `.dockerignore`; modify `apps/api/src/main.ts` and `deploy/compose/docker-compose.yml`.

- [x] Build the API and portal into the app image and serve portal routes/assets from the API process when configured.
- [x] Build the orchestrator worker image with Node 22, Python 3.12, and Git; run it as non-root.
- [x] Align the published host port with the API's internal port and make the app's shared data mount read-only.

### Task 2: GHCR build and SSH deployment

**Files:** Create `.github/workflows/deploy.yml`.

- [x] Build and publish both images on `master` pushes and manual dispatch from `master`, tagging each image with the commit SHA.
- [x] Gate deployment on both image builds completing successfully.
- [x] Validate required variables/secrets, use pinned SSH known-hosts data and password auth, transfer the Compose bundle, set registry/version in the existing host `.env`, pull and restart the stack.

### Task 3: Decision and operator setup guide

**Files:** Create `docs/decisions/0039-github-actions-ghcr-deployment.md`; modify `docs/decisions/README.md`, `docs/guides/installation.md`, `deploy/compose/README.md`.

- [x] Record the portable GHCR default and SSH deployment decision.
- [x] Document first-time host setup, environment fields, GitHub Actions variables/secrets, PAT scope, and manual deployment steps.

### Verification

- [x] Build the API/portal TypeScript targets and both container targets.
- [x] Validate Compose interpolation with a temporary non-secret environment and parse the workflow YAML.
- [x] Review the final diff and workflow secret handling; GitHub workflow/SSH deploy still require GitHub repository configuration.
