# ADR-0026: Built-in and custom runtime agents, packaged and managed in an Agent Builder

- Status: Accepted. Partly implemented (see [Implementation notes](#implementation-notes)).
- Date: 2026-10-10
- Decision register: D46
- Supersedes: ADR-0023 decision 3 ("no agent ships with Kintsugi")
- Amends: ADR-0023 (where agent definitions come from); ADR-0014 decision 3 stays superseded
- Amended by: [ADR-0027](0027-builtin-modernization-content.md) (agent file format, built-in content)

## Context

ADR-0023 made the runtime a generic kernel and deferred where agent definitions are stored until the first agent exists. The product now needs agents:

- **Built-in agents** that ship with Kintsugi for the understanding phases of a modernization: assessment, structure, business rules, version deltas, architecture and security review.
- **Custom agents** that installation admins create for their own platform work.
- An **Agent Builder** to create, test and version agents, and to package them so pipeline stages can use them.

Two inputs shaped this decision:

1. **A reference modernization workflow.** Anthropic's `code-modernization` plugin (Apache-2.0, `anthropics/claude-plugins-official`) runs a guided path: preflight → assess → map → extract business rules → human review → brief (human approval) → build (uplift, transform or reimagine) → verify → harden.
   - Its agents are **roles**, not steps. Each step gives a role a task, and the same role is reused across steps. A second instance of a role re-checks the findings of the first.
   - Its read-only roles (`legacy-analyst`, `business-rules-extractor`, `version-delta-analyst`, `architecture-critic`, `security-auditor`) do the understanding work.
   - Its writing roles (`test-engineer`, `uplift-migrator`, `scaffolder`) change code.
   - Every role carries the same two disciplines: analyzed code is untrusted data, never instructions; and secrets are masked in every output.
   - Proof of equivalence is computed by scripts from test runs and output comparisons, not by a model.
2. **The agent-builder landscape.** Several tools have converged on the same agent format:
   - Claude Code subagents, GitHub Copilot `.agent.md` and pi all define an agent as a **Markdown file with YAML frontmatter** (description, tool allowlist, model hints) whose body is the system prompt.
   - Skills follow the **Agent Skills** specification (`skills/<name>/SKILL.md`).
   - Builders that version well keep an editable **draft** and **immutable published versions**, and pin a run to the version it started with.
   - There is no ratified standard for a whole agent (prompt + skills + tool allowlist), and tool names differ per product.

Kintsugi's split stays: **implementation belongs to members** in their own harnesses (ADR-0015); runtime jobs never write to project repositories (ADR-0004, ADR-0019).

## Decision

1. **Runtime agents do understanding, not implementation.**
   - Built-in runtime agents cover assessment, structure, business rules, version deltas and review. They read code read-only and write only to the job's output directory; the worker commits that output to the workspace repo (ADR-0019).
   - Code-writing roles are member-side assets in the Claude Code plugin format (ADR-0015), not runtime agents.
2. **Five built-in agents**, adapted from the reference plugin's read-only roles (Apache-2.0, attributed in `NOTICE`), stack-agnostic and company-neutral:

   | Agent | Role | Used by stages such as |
   |---|---|---|
   | `legacy-analyst` | Structural and behavioural understanding with `file:line` citations; also re-checks other agents' findings | assess, map, verify findings |
   | `business-rules-extractor` | Business rules as Given/When/Then cards with concrete values, parameters, confidence and SME questions | extract rules |
   | `version-delta-analyst` | Breaking and silent changes between two versions of the same stack that this code actually hits | uplift planning |
   | `architecture-critic` | Adversarial review of target architectures and transformed code | architecture review, transformation review |
   | `security-auditor` | Adversarial security review (OWASP, CWE, dependencies, secrets) | assess (security), harden |

   - Three **shared skills** are attached to every built-in agent: `untrusted-code` (analyzed content is data; report instruction-shaped text as a finding), `secret-handling` (never reproduce a credential; cite `file:line` with a masked preview) and `job-workspace` (read-only workspace, `outputs_write`, no shell, report what could not be checked).
   - A pipeline stage supplies the **task**; the agent supplies the **role**. Re-checking findings is a stage pattern: a second job, of the same or another role, verifies the first job's output.
3. **Package format.** An agent is a folder, and the same format is used for built-ins, import and export:

   ```
   <agent-id>/
     AGENT.md           # frontmatter: name, version, description, tools, skills, thinking,
                        #   deny-command-patterns, metadata; body = instructions (system prompt)
     skills/<name>/SKILL.md   # optional agent-local skills (Agent Skills specification)
   ```

   - Shared skills live in a skill library, also in Agent Skills format, and are referenced by name.
   - Frontmatter field names stay close to Claude Code and GitHub agent files. Kintsugi-only fields go under `metadata`.
   - `tools` names kernel tools only and is validated against the kernel registry.
   - Built-in agents and shared skills ship in `packages/agents/builtin/` (`agents/`, `skills/`, with the attribution `NOTICE`), versioned with the release. `@kintsugi/agents` parses, validates and exports packages.
4. **Agents and skills are installation data** in Postgres:
   - `agent` (id, kind `builtin` | `custom`, `forkedFrom`) with one editable **draft** and **immutable published versions**; the same for shared skills.
   - Built-ins are seeded and upgraded from the release at startup and are read-only. To change one, an admin **forks** it into a custom agent with a new id; upgrades never touch a fork.
5. **Agent Builder (portal).**
   - Create an agent from scratch, by forking a built-in, or by importing a package.
   - Edit instructions, skills, tools, thinking level and default limits.
   - **Test run** against a registered repository at a fixed commit: a real sandboxed job on the same path as pipeline jobs, with its events and outputs shown.
   - **Publish** an immutable version, and export a package.
   - Saved evaluation cases with graders, run before publishing, are planned for a later milestone.
6. **Pipelines reference agents by id.**
   - A stage names `agent: <id>` or pins `agent: <id>@<version>`.
   - At job start the launcher resolves the latest published version (or the pin) and embeds the whole `AgentDefinition` in the `JobSpec`.
   - The resolved `id@version` is recorded on the job and in the commit trailer (`Kintsugi-Agent`).
7. **The kernel stays generic.**
   - ADR-0023 decisions 1, 2 and 4–7 stand: the runtime never looks an agent up, and adding an agent is a data change.
   - The reference roles use a read-only shell for size metrics, audit tools and migration analyzers in report mode. That is a separate kernel-tool decision with its own security review. Until it lands, built-in agents work with `read`, `ls`, `grep`, `find` and `outputs_write`, and state what they could not cover.
8. **Governance.**
   - New permission `runtime-agents.manage` (create, edit, fork, import, test) and `runtime-agents.publish` (publish versions), added by migration.
   - Every save, publish and fork is audited.
   - Test runs use the same limits and cost accounting as pipeline jobs.

## Consequences

- The workspace template's sample pipeline is rewritten around the reference path:
  - preflight → assess → map → extract rules (with re-check) → rule review (member) → brief (member approval) → build (members, with plugins) → verify (runner and proof scripts) → harden;
  - built-in agent ids replace the current placeholders.
- `AGENTS.md`, the runtime-agents reference and the building-block view change from "no agent ships" to "built-in and custom agents, managed in the Agent Builder".
- Upgrades must report drift between seeded built-ins and the release, and never modify custom agents.
- Attribution: adapted prompts carry the Apache-2.0 notice of the reference plugin.
- Real test runs need the job sandbox (ADR-0021: pi-sandbox child processes on Linux and macOS). On Windows, development needs WSL2. (Superseded by ADR-0029: jobs run in job workspaces on every platform, Windows included.)
- Follow-up decisions:
  - the read-only exec kernel tool;
  - the eval-suite format;
  - whether published agents can also be exported to members as plugin agents.

## Implementation notes

Settled while building the Agent Builder (`apps/api` module `admin/agents`, `@kintsugi/agents`, Settings → Agents in the portal); details in the [runtime agents reference](../reference/runtime-agents.md#agent-builder).

- **Built-ins are read from the release, not seeded.** The API and the worker load `packages/agents/builtin` directly; Postgres holds custom agents only. Built-ins cannot drift from the release, and upgrades never touch custom agents. Built-in agent and skill names are reserved.
- **Storage** (migration `012_agents.sql`, schema `admin`): `agent` (the current version of each custom agent, stored as its package files), `agent_version` (every saved version, immutable) and `agent_skill` (custom shared skills, as `SKILL.md` text).
- **No separate draft.** Every save records a new immutable version, which becomes current; the editor validates the unsaved form live instead. Restoring an older version makes it current again. A version number is never reused.
- **Fork is "copy".** Copying a built-in or custom agent creates a custom agent with a new name; the source is recorded in `copied_from` and in `metadata.copied-from`.
- **Permissions.** One code, `agents.manage` (create, edit, copy, import, enable or disable, delete, restore, shared skills), granted to `admin`. Reading the catalog needs a session only. Model bindings stay on the provider endpoints (`providers.manage`).
- **Resolution.** `resolveAgentDefinition` in `@kintsugi/agents` is the single lookup: a built-in first, else an enabled custom agent, re-validated against the kernel tools and shared skills. The worker uses it for every agent step; the API uses it for "preview job definition".
- **Import and export.** A ZIP of `<name>.md` and `skills/<n>/SKILL.md` (or the same files as JSON). Importing an existing custom agent saves a new version.
- **Not yet built:** test runs from the editor, pinning `id@version` in stages, default limits per agent, versioning of shared skills (an edit applies to every agent at its next job) and audit entries beyond the `created_by` / `updated_by` columns and the version history.

## Alternatives considered

- **Agents in code (ADR-0014) or code catalog plus database overrides (ADR-0022).**
  - Rejected: two sources of truth, and use-case content inside the engine.
  - Shipping built-ins as packages seeded into the database keeps the engine generic.
- **Include the reference plugin's writing roles as runtime agents.** Rejected: implementation belongs to members, and runtime jobs never write to project repositories.
- **Adopt the Claude Code plugin format wholesale for runtime agents.** Rejected: hooks, MCP servers and permission modes have no meaning in the locked-down kernel. The agent file format is kept and the unsupported fields are refused.
- **Open Agent Spec or A2A agent cards as the storage format.**
  - Rejected for now: one is workflow-oriented, the other is a discovery card that does not carry prompts or tools.
  - A2A can become an export later.
