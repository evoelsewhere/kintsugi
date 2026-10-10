# Glossary

| Term | Meaning |
|---|---|
| **7R** | Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Rebuild, Repurchase: the transformation strategies for an application |
| **Access role** | Installation-wide permission bundle, such as `admin`, `contribute`, `user`, or an admin-defined access sub-role; managed in Admin → Members & Permissions |
| **Capability** | A group of rulebook content a pipeline stage depends on. Seven are well-known; projects can add custom ones |
| **Capability maturity** | `template` → `draft` → `ready` (or `suspended`): how far a capability has been adapted and verified, optionally scoped per unit kind / application |
| **AS-IS / TO-BE KB** | Knowledge base of the current / target system. Sources are in Git; the index (vector + graph) is in Postgres |
| **Code repo** | Umbrella term for source and target repos. A project usually has many, possibly on different Git servers |
| **Digital worker** | An AI work profile such as reverse design, version upgrade or unit-test generation. In Kintsugi it is an agent plugin plus a task-pack template, run in a member's harness, with runtime agents preparing and reviewing the work |
| **Gate** | Quality / approval checkpoint: G0–G6 per phase, plus per-work-item gates |
| **Harness** | An environment that runs an AI agent (pi, Claude Code, GitHub Copilot, Codex…) |
| **Installation** | One self-hosted Kintsugi instance (Docker Compose), serving one organization |
| **Kintsugi Runtime** | Kintsugi's agent environment, built on pi; one `kintsugi-runner` container per job |
| **Member harness** | The AI tool a member uses locally: Claude Code, GitHub Copilot, ChatGPT/Codex |
| **Pack** | A self-contained part of a rulebook for one stack pair or concern; applications select the packs that apply to them |
| **Pipeline definition** | `rulebook/pipelines/<id>.yaml`: the phases, stages, performers, required capabilities and gates an application follows |
| **Pilot unit** | A unit flagged `pilot: true`, used to verify `draft` rulebook capabilities before promoting them |
| **Project build** | Shaping a project before running the pipeline: bootstrap the workspace repo, then shape and verify the rulebook |
| **Project role** | RACI responsibility from `@kintsugi/domain`, such as `pm`, `architect`, `ba`, `dev`, `qc`, or an `ai-*` role; assignment per project membership is planned with M0 project persistence |
| **PAT** | Personal Access Token, used by the CLI and MCP clients |
| **Resolved view** | The rules that apply to one unit after composing vendored content, packs and overrides, each with the layer it came from |
| **Rulebook** | The project's rules in `rulebook/` of the workspace repo: packs (stack pairs, unit kinds, conventions, mappings, review rules, runners), pipelines, harness renderers, waivers |
| **Runtime agent** | A platform agent executed by the runtime kernel: an agent definition (instructions, skills, tool allowlist) supplied with each job. None ships yet; planned examples are assessment, task-planner and gate-reviewer ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)) |
| **Scorecard** | Weighted assessment of an application across business, technical, feasibility, cost and risk criteria |
| **Source repo** | A legacy code repo; always read-only for the runtime |
| **Agent plugin** | A package in the Claude Code plugin format (`.claude-plugin/plugin.json` + skills, agents, commands, hooks, MCP) installed into member harnesses; the built-in one is `kintsugi` |
| **Hook** | A plugin component that runs on harness lifecycle events (session start, before / after tool use, stop), e.g. the write guard and activity reporting |
| **Marketplace** | A `marketplace.json` listing plugins; Kintsugi generates one per project in the workspace repo |
| **Skill** | An Agent Skills folder (`SKILL.md`) inside a plugin, namespaced `<plugin>:<skill>` |
| **Target base** | The target repo as scaffolded by the solution architect (framework, layering, conventions, CI) before units are converted into it |
| **Task pack** | Context for one work item (spec, AS-IS excerpts from the KB, rules, acceptance criteria, suggested skills) for a member's harness |
| **Stale unit** | A unit whose applied rules changed after it was processed; listed for re-review |
| **Unit file** | `units/<app>/<module>/<unit>.md` in the workspace repo; its frontmatter is the work item's state (ADR-0012) |
| **Vendored rulebook** | An external rulebook or pack pinned and copied into `rulebook/vendor/<id>@<version>/` via `extends` |
| **Waiver** | A time-boxed, owner-approved exception that lets a stage run without the required capability readiness |
| **Wave** | A group of applications or work items migrated together, by pattern |
| **Work item** | Unit of migration (feature / screen / module / API / DB object) that moves through stages |
| **Workspace repo** | The project's Git repo for configuration (`kintsugi.yaml`), inventory, assessment, ADRs, AS-IS/TO-BE docs, task packs, deliverables |
