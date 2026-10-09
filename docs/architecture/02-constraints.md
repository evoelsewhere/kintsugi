# 2. Constraints

## 2.1 Technical constraints

| Constraint | Background |
|---|---|
| Self-hosted package, Docker Compose on a single host, no Kubernetes | [ADR-0006](../decisions/0006-self-hosted-package.md) |
| One installation = one organization, no multi-tenancy | [ADR-0006](../decisions/0006-self-hosted-package.md) |
| Git is the source of truth for code, documents, deliverables and assets | [ADR-0007](../decisions/0007-git-as-source-of-truth.md) |
| PostgreSQL (with pgvector) is the only datastore; no broker, no separate vector or graph DB | [ADR-0010](../decisions/0010-postgres-only.md) |
| Orchestration on pg-boss (Postgres) | [ADR-0003](../decisions/0003-postgres-job-queue.md) |
| TypeScript on Node ≥ 22; the runner follows pi's requirement (Node ≥ 22.19) | [ADR-0002](../decisions/0002-typescript-monorepo.md) |
| pi is pinned to an exact version; only its MIT core packages are used | [ADR-0001](../decisions/0001-pi-as-kintsugi-runtime.md) |
| The runtime never writes to repositories; runner containers are read-only except `/out` | [ADR-0004](../decisions/0004-runner-container-per-job.md) |

## 2.2 Organizational constraints

| Constraint | Background |
|---|---|
| Implementation is done in members' own harnesses, under their own licenses | [ADR-0001](../decisions/0001-pi-as-kintsugi-runtime.md) |
| Runtime LLMs are configured per installation; consumer subscription logins are not allowed for the runtime | [ADR-0009](../decisions/0009-llm-provider-config.md) |
| Sign-in starts with local username/password; Entra ID comes later | [ADR-0008](../decisions/0008-authentication.md) |
| Installations often sit on internal networks without inbound access from Git servers | [ADR-0007](../decisions/0007-git-as-source-of-truth.md) (polling by default) |

## 2.3 Conventions

- **Documentation**: English and company-neutral ([docs conventions](../README.md#conventions)).
- **Decisions**: architecture changes go through ADRs ([template](../decisions/template.md)).
- **Assets**: canonical formats are Agent Skills (`SKILL.md`) + `AGENTS.md`; harness-specific files are rendered, never hand-written ([ADR-0005](../decisions/0005-canonical-asset-format.md)).
