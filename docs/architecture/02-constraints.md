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
| The runtime never writes to repositories; a job's source and inputs are read-only and it writes only to its output and scratch directories | [ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md) |
| Kintsugi ships no stack-specific content; projects write their standards in their document repo | [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md) |
| Extensions (harness transformer plugins) require installation-level allowlists | [ADR-0015](../decisions/0015-member-assets-as-agent-plugins.md) |
| No code graph or language parsing; no unit-discovery configuration; no runtime-agent configuration in any project repo | [ADR-0014](../decisions/0014-no-code-graph-no-agent-config.md) |
| The runtime is a generic agent kernel; agents are installation data (built-in and custom), resolved by the launcher and supplied whole per job | [ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md), [ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md) |
| Legacy repos are always read-only; target repos are scaffolded by the project before convert, and only members write to them | [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md) |

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
- **Assets**: member-harness assets are agent plugins in the Claude Code plugin format (skills, agents, commands, hooks, MCP), distributed through generated marketplaces; harness-specific files are generated, never hand-written ([ADR-0015](../decisions/0015-member-assets-as-agent-plugins.md)).
