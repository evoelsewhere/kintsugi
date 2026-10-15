# Glossary

| Term | Meaning |
|---|---|
| **7R** | Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Rebuild, Repurchase: the transformation strategies for an application |
| **Access role** | Installation-wide permission bundle, such as `admin`, `contribute`, `user`, or an admin-defined access sub-role; managed in Admin → Members & Permissions |
| **AS-IS / TO-BE KB** | Knowledge base of the current / target system. Sources are in Git; the index (vector + graph) is in Postgres |
| **Code repo** | Umbrella term for source and target repos. A project usually has many, possibly on different Git servers |
| **Digital worker** | An AI work profile such as reverse design, version upgrade or unit-test generation. In Kintsugi it is an agent plugin plus a task-pack template, run in a member's harness, with runtime agents preparing and reviewing the work |
| **Gate** | Quality / approval checkpoint: G0–G6 per phase, plus per-unit gates |
| **Harness** | An environment that runs an AI agent (pi, Claude Code, GitHub Copilot, Codex…) |
| **Installation** | One self-hosted Kintsugi instance (Docker Compose), serving one organization |
| **Kintsugi Runtime** | Kintsugi's agent environment, built on pi; runs in the worker, one job workspace per job |
| **Job workspace** | `<data>/jobs/<id>/`: the read-only source checkout (`src`) and inputs (`in`), the writable output (`out`) and scratch (`tmp`) of one job run; the isolation boundary of runtime jobs and script steps, without an OS sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)) |
| **Member harness** | The AI tool a member uses locally: Claude Code, GitHub Copilot, ChatGPT/Codex |
| **Pipeline definition** | The phases, stages, performers and gates an application follows: built-in, or declared in `kintsugi.yaml` |
| **Pilot unit** | A unit flagged `pilot: true`, run first to check the project's standards before work at scale |
| **Project build** | Setting a project up: create or join the document repo, register the AS-IS and TO-BE repos, write the standards |
| **Project role** | RACI responsibility from `@kintsugi/domain`, such as `pm`, `architect`, `dev`, `qc` or `ai-champion`; pipelines may name their own; assignment per project membership is planned with M0 project persistence |
| **PAT** | Personal Access Token, used by the CLI and MCP clients |
| **Runtime agent** | A platform agent executed by the runtime kernel: an agent definition (instructions, skills, tool allowlist) supplied with each job. Built-in agents cover the understanding phases (legacy-analyst, business-rules-extractor, version-delta-analyst, architecture-critic, security-auditor); admins create more in the Agent Builder ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)) |
| **Scorecard** | Weighted assessment of an application across business, technical, feasibility, cost and risk criteria |
| **Legacy repo** | A legacy code repo; always read-only for the runtime |
| **Agent plugin** | A package in the Claude Code plugin format (`.claude-plugin/plugin.json` + skills, agents, commands, hooks, MCP) installed into member harnesses; the built-in one is `kintsugi` |
| **Hook** | A plugin component that runs on harness lifecycle events (session start, before / after tool use, stop), e.g. the write guard and activity reporting |
| **Marketplace** | A generated `marketplace.json` listing published plugins for a harness; document-repo marketplace generation is planned and the output is never hand-edited |
| **Skill** | An Agent Skills folder (`SKILL.md`) inside a plugin, namespaced `<plugin>:<skill>` |
| **Target base** | The target repo as scaffolded by the solution architect (framework, layering, conventions, CI) before units are converted into it |
| **Task pack** | Context for one unit (spec, AS-IS excerpts from the KB, rules, acceptance criteria, suggested skills) for a member's harness |
| **Unit file** | `units/<app>/<module>/<unit>.md` in the document repo; its frontmatter is the unit's state (ADR-0012) |
| **Wave** | A group of applications or units migrated together, by pattern |
| **Work item** | Legacy API/domain term corresponding to a unit. Use **unit** in documentation; existing API/CLI names are unchanged. |
| **Document repo** | The project's single Git repo for everything except code; see the [layout reference](document-repo.md) for current paths and planned homes |
| **Legacy repo** | An AS-IS repo with role `legacy` (code) or `legacy-data` (data); always read-only for Kintsugi |
| **Standards** | The project's target conventions, mappings and review rules: plain documents in `standards/` of the document repo |
| **Target repo** | A TO-BE repo with role `target`, implementing one architecture `component`; only members write to it |
