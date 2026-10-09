# ADR-0006: Kintsugi is distributed as a self-hosted package

- Status: Accepted
- Date: 2026-10-09

## Decision
- Kintsugi is a **package that each project deploys and operates itself**.
- One installation serves one organization or project group. There is no multi-tenancy.
- Distribution artifacts:
  - container images: `kintsugi-app`, `kintsugi-worker`, `kintsugi-runner`
  - a Docker Compose bundle (`deploy/compose`) with `.env.example`
  - the `kintsugi` CLI for members
  - offline image tarballs for air-gapped sites
- **No Kubernetes requirement.** A single Docker host is the reference deployment.

## Consequences
- There are no tenant columns or row-level security. Authorization is scoped per project and role.
- Upgrades mean pulling new images; database migrations run on app start. Backups mean backing up Postgres; Git holds the primary content (ADR-0007).
- Avoid cloud-specific managed services in the core.
