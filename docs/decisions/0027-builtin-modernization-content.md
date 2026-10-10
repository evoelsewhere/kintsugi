# ADR-0027: Runtime plugins: agents, skills, commands, workflows, scripts, hooks, assets and tests in one package

- Status: Proposed
- Date: 2026-10-10
- Decision register: D47
- Amends: ADR-0026 (the package format and the unit of distribution)

## Context

ADR-0026 packages a runtime agent as `AGENT.md` plus Agent Skills. An agent on its own is not usable, though. The reference workflow (Anthropic's `code-modernization` plugin, Apache-2.0) needs several more parts:

- **Commands**: one per step (assess, map, extract-rules, …). Each says which agents to start, with which task, which artifacts it reads and writes, and in what format.
- **Workflows**: fan-out and verification. For example, extract-rules runs one extractor per module, one referee per candidate rule, a two-lens panel for each critical rule, a consolidation pass and a data-object catalog.
- **Scripts**: deterministic steps whose result must not depend on a model. Examples: making shards, rendering rule cards, comparing outputs, computing proof verdicts, building the report.
- **Hooks**: code that runs on lifecycle events.
- **Assets**: report and viewer templates.
- **Tests**: fixtures and checks for all of the above.

Shipping agents without their commands, workflows and scripts would leave every installation to reinvent the method. Member assets already use the Claude Code plugin layout (ADR-0015), so the same layout should carry runtime content, adapted to a server where no person sits in front of a session.

## Decision

1. **The unit of distribution is a runtime plugin.** It uses the Claude Code plugin layout with a Kintsugi manifest:

   ```
   <plugin>/
     .kintsugi-plugin/plugin.json   name, version, description, author, license, settings schema
     agents/<name>.md               runtime agents (frontmatter + system prompt), as in Claude Code
     skills/<name>/SKILL.md         Agent Skills; shared by the plugin's agents
     commands/<name>.md             stage commands: what a pipeline stage runs
     workflows/<name>.yaml          multi-job flows a command can run
     scripts/<name>.{py,mjs}        deterministic steps, run in the job sandbox
     hooks/hooks.json               job and stage lifecycle hooks (server-side)
     assets/                        templates used by scripts and the portal
     tests/                         fixtures and eval cases
     README.md  CHANGELOG.md  LICENSE  NOTICE
   ```

   - Agents become flat `agents/<name>.md` files, as in Claude Code plugins, replacing ADR-0026's `AGENT.md` folder.
   - Agent frontmatter keeps ADR-0026's fields and refusals. In particular, `tools` names kernel tools only.
2. **Commands are stage tasks.** A command file's frontmatter declares:
   - `description`;
   - `arguments` (named, with defaults);
   - `agent` (single-job commands) or `workflow` (multi-job commands);
   - `reads` and `writes`: workspace-repo artifacts by path pattern;
   - `requires`: rulebook capabilities.

   The body is the task prompt, with `{{argument}}` and `{{artifact}}` placeholders that the orchestrator fills in. Pipeline stages name commands (`performer: {command: modernization:extract-rules}`); a stage that names a bare agent keeps working (ADR-0026).
3. **Workflows are declarative, not code.**
   - A workflow is a YAML graph of steps:
     - `agent` jobs, each with a task, a JSON output schema and limits;
     - `fanout` over a list (modules from `topology.json`, findings from an earlier step), with a concurrency cap and an agent and token budget;
     - `script` steps;
     - `gate` steps, which wait for a person through the portal;
     - `merge` steps (dedupe by key, keep-most-conservative fields).
   - The orchestrator interprets them, so plugins never run code inside the worker.
   - Every agent output is validated against its schema.
   - Anything a step could not cover (a dead finder, an unjudged finding, a skipped module) is recorded as a **coverage gap**, never dropped.
   - Upstream agent output is passed to downstream prompts **fenced as untrusted data**.
4. **Scripts are deterministic steps in the sandbox.**
   - A script runs as a job without an LLM, under the same sandbox policy as agent jobs (ADR-0021):
     - read-only workspace;
     - writable output directory;
     - no network;
     - no credentials.
   - Interpreters: Node (always present) and Python 3, which the worker image ships.
   - Scripts treat all inputs as hostile. They are how verdicts are computed: a proof verdict comes from a script, never from a model.
5. **Hooks are server-side and declarative.**
   - Events:
     - `JobStart`, before an agent job starts (for example, prepare inputs);
     - `JobOutput`, after a job finishes, before its output is committed (for example, scan for credentials or validate an artifact's format; a failing hook blocks the commit);
     - `StageComplete`;
     - `GateDecision`.
   - Each hook runs a plugin script in the sandbox.
   - The pi kernel itself still runs no hooks (ADR-0023).
   - The reference plugin's session hooks (telemetry, live pane) have no server-side meaning and are not carried over; the portal shows progress from job events.
6. **Assets and tests travel with the plugin.**
   - Assets are templates read by scripts and by the portal (report, topology viewer).
   - `tests/` holds fixture repositories and eval cases (task, fixture, graders: artifact exists, regex, schema, script verdict, LLM rubric). The Agent Builder runs them before a version is published (ADR-0026 decision 5).
7. **Built-in plugin `modernization`** ships with Kintsugi, versioned with the release and seeded like ADR-0026's built-ins (read-only; fork to change). It is adapted from the reference plugin with attribution, limited to the understanding phases (ADR-0026 decision 1):
   - **agents**: `legacy-analyst`, `business-rules-extractor`, `version-delta-analyst`, `architecture-critic`, `security-auditor`;
   - **skills**: shared disciplines (`untrusted-code`, `secret-handling`, `job-workspace`) and method skills (assessment, topology mapping, rule cards, delta catalog, security findings, architecture review, finding verification);
   - **commands**: `preflight`, `assess`, `map`, `extract-rules`, `deltas`, `harden-scan`, `review-architecture`, `review-transformation`;
   - **workflows**: rule extraction (per-module extract, citation referees, P0 panel, consolidation, data objects), delta catalog (four categories, referees), security scan (five finder classes, refuters, second judge for Critical and High);
   - **scripts**: making shards, rendering rules and data objects, the topology check, building the report, scanning output for credentials;
   - **hooks**: `JobOutput` credential scan and artifact-format checks;
   - **assets**: report and topology-viewer templates;
   - **tests**: a small fixture system with eval cases per command.

   Build commands (uplift, transform, reimagine) and the proof scripts that judge built code belong to member plugins and runners. They are not part of this plugin.
8. **Installation data.**
   - Plugins are installed into the installation: built-in, forked, or imported from a package.
   - Each plugin has a draft and immutable published versions, as ADR-0026 specified for agents.
   - Agents, skills, commands and workflows are addressed as `<plugin>:<name>`; a pipeline pins `<plugin>@<version>`.

## Consequences

- The orchestrator gains a workflow interpreter, a script runner and hook dispatch; all three run inside the job sandbox launcher (ADR-0021).
- The worker image adds Python 3.
- `@kintsugi/agents` becomes the plugin package library: parse, validate and export every component, and resolve commands and workflows into jobs.
- The pipeline template is rewritten around the built-in commands.
- The reference plugin's JavaScript workflows are re-expressed in YAML. Their safety properties carry over:
  - fenced untrusted data;
  - agent and token caps with reported gaps;
  - deterministic ordering for resumable runs.
- Follow-up decisions:
  - the exact workflow schema (versioned by `schemaVersion`);
  - grader types for tests;
  - whether member plugins and runtime plugins share one marketplace.

## Alternatives considered

- **Agents and skills only (ADR-0026 as written).** Rejected: the method lives in the commands, workflows and scripts. Without them, every installation rebuilds it.
- **JavaScript workflows, as in the reference plugin.** Rejected: running plugin code inside the orchestrator gives imported plugins code execution outside the sandbox. A declarative graph is enough for fan-out, verification and gates.
- **Hooks inside the pi session.** Rejected: the kernel stays locked down (ADR-0023). Lifecycle hooks belong to the orchestrator, around jobs.
