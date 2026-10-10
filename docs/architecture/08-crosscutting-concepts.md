# 8. Crosscutting concepts

| Concept | Summary |
|---|---|
| [Runtime and member harnesses](concepts/runtime-and-member-harnesses.md) | pi runs Kintsugi's own agents; members implement with Claude Code / Copilot / ChatGPT-Codex; the standard work-item loop |
| [Project rulebook](concepts/project-rulebook.md) | Kintsugi is a common engine; each project builds and verifies its rulebook (`template` → `draft` → `ready`) before dependent stages run |
| [Git as the source of truth](concepts/git-as-source-of-truth.md) | Many Git servers and repos; workspace repo; how runtime results reach Git; what Postgres keeps |
| [Security](concepts/security.md) | Runner isolation, untrusted repos, credentials, network, Docker API, member-harness policy, audit |
| [Identity and access](concepts/identity-and-access.md) | Local sign-in and PATs; installation access roles; project-role assignment for RACI planned with M0 membership persistence; Entra ID later |
| [LLM configuration](concepts/llm-configuration.md) | Provider registry for the runtime, model binding, budgets |
| [Observability and telemetry](concepts/observability-and-telemetry.md) | Runtime events and cost, member-harness activity, AI metrics inputs |

The shared domain vocabulary (phases, 7R, project roles, work items, provenance) is defined in [`packages/domain`](../../packages/domain/src/index.ts) and described in the [data model](../reference/data-model.md). Installation access roles are a separate identity-and-access concept.
