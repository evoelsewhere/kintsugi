# ADR-0027: Built-in modernization content in packages/agents: agents, commands, workflows, scripts, hooks and tests

- Status: Accepted. Amended by [ADR-0028](0028-remove-rulebook-single-document-repo.md): commands that apply project standards read `standards/` in the document repo. Amended by [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md): the standard script environment (decision 5) is the job workspace, not a bubblewrap sandbox; network access is not blocked. Amended by [ADR-0033](0033-assess-catalog-understand-selection.md): the runtime understanding stages are `assess` (which builds the item catalog) and `understand` (which runs map, extract-rules and harden as steps on a selection of items).
- Date: 2026-10-10
- Decision register: D47
- Amends: ADR-0026 (agent file format and what ships with Kintsugi)

## Context

ADR-0026 ships five runtime agents. An agent on its own is not usable, though. The reference workflow (Anthropic's `code-modernization` plugin, Apache-2.0) also needs:

- **Commands**: one per step (assess, map, extract-rules, …). A command says which agents to start, with which task, which artifacts it reads and writes, and in what format.
- **Workflows**: fan-out and verification. For example, extract-rules runs one extractor per module, one referee per candidate rule, a two-lens panel for critical rules, a consolidation pass and a data-object catalog.
- **Scripts**: deterministic steps whose result must not depend on a model, such as making shards, rendering rule cards, comparing outputs, computing proof verdicts and building the report.
- **Hooks**: code that runs on lifecycle events.
- **Tests**: checks for all of the above.

Rebuilding that method by hand would lose most of its value.

## Decision

1. **The upstream content is copied in full into `packages/agents/builtin/` and adapted to Kintsugi there.**
   - Source: `plugins/code-modernization` of `anthropics/claude-plugins-official`, pinned at commit `c8874f5`. The license and a `NOTICE` that lists the changes ship beside it.
   - `assets/` (report and viewer templates, screenshots, vendored Mermaid) is removed. Presentation belongs to the portal, which will show the same information directly.
   - The first commit is the unmodified copy; every adaptation is a separate commit, so the history shows each change against the upstream text.
   - It is Kintsugi's built-in content, not a plugin: there is no plugin manifest or marketplace for it.
2. **Layout and how each part maps to Kintsugi:**

   | Path | Kintsugi meaning |
   |---|---|
   | `agents/<name>.md` | Agent files in the Claude Code format. `metadata.audience` decides who runs the agent. `runtime` agents (`legacy-analyst`, `business-rules-extractor`, `version-delta-analyst`, `architecture-critic`, `security-auditor`) run in the kernel with kernel tools. `member` agents (`test-engineer`, `uplift-migrator`, `scaffolder`) run in members' harnesses with harness tools. |
   | `commands/<name>.md` | Stage commands. Understanding commands run as runtime jobs; build and verify commands are member work. |
   | `workflows/` | Multi-job flows. The orchestrator executes them; until a workflow is re-expressed in a form the orchestrator interprets, the upstream script is the specification. Plugin code never runs inside the worker. |
   | `scripts/` | Deterministic steps, run as script jobs without an LLM in the standard script environment (decision 5). |
   | `hooks/` | Server-side lifecycle hooks around jobs (for example, scanning output for credentials before it is committed). The upstream session hooks (telemetry, live pane) are replaced by the portal and job events. |
   | `tests/` | Fixtures and checks for the content above. |

3. **Path mapping**, applied throughout the adapted text:
   - `legacy/<system>` becomes the registered source repository, read at the job's commit, read-only;
   - `analysis/<system>/` becomes `assessment/<app>/` in the project's workspace repository, committed by the worker;
   - `modernized/` becomes the target repository (member work);
   - `<system>` becomes `<app>`, the application id in `kintsugi.yaml`;
   - questions to a person (preflight answers, rule review, brief approval) become portal tasks and gates.
4. **Agent file format.**
   - An agent is a Claude Code agent file `<name>.md` (frontmatter + system prompt) with optional `skills/<name>/SKILL.md`. This replaces ADR-0026's `AGENT.md` folder.
   - Frontmatter: `name`, `version`, `description`, `tools`, optional `skills`, `thinking`, `deny-command-patterns`, and `metadata` (including `audience`).
   - Runtime agents name kernel tools only and may not set `model`, `hooks`, `mcpServers`, `permissionMode`, `disallowedTools` or `maxTurns`.
   - `@kintsugi/agents` parses, validates, exports and converts them; member agents are never converted into kernel jobs.

5. **The standard script environment.** Every script step runs in one prepared environment, whether the script ships
   in `builtin/scripts/` or an agent wrote it during a stage (for example the `map` stage's
   `extract_topology.py`). Scripts run without a review gate; the environment is the safety boundary:
   - **Interpreters:** Python 3.12 and Node 22, with their standard libraries only. Nothing is installed at run
     time, and there is no package index or registry access. Extra libraries can be added to the environment by
     an image change, with a security review.
   - **Filesystem:** the source repository at the job's commit, mounted read-only; the inputs the step declares
     (workspace artifacts), read-only; the job's output directory and a private scratch directory, writable and
     deleted after the job (the output is collected first). Nothing else is visible.
   - **Isolation:** the same sandbox as runtime agent jobs (ADR-0021: pi-sandbox child process with bubblewrap on
     Linux), a non-root user, no network, no credentials or Kintsugi tokens in the environment.
   - **Limits:** wall-clock timeout, CPU, memory, process count and output size, set per step with installation
     defaults; exceeding one fails the step with a clear reason.
   - **Provenance:** a model-written script is committed with the artifacts it produced, and the job records the
     script's hash, so the result can be reproduced and audited.

## Consequences

- The workspace repository layout gains the `assessment/<app>/` artifacts of the understanding phases: assessment, topology, business rules, data objects, delta catalog, security findings, brief and rule reviews.
- The orchestrator needs a workflow executor, a script runner and hook dispatch inside the job sandbox launcher (ADR-0021).
- The worker image provides the standard script environment (Python 3.12, Node 22, standard libraries only).
- The member plugin (ADR-0015) will carry the member agents and build commands to members' harnesses.
- Until each part is adapted, the content under `builtin/` is excluded from the repository lint.

## Alternatives considered

- **Agents and skills only (ADR-0026 as first written).** Rejected: the method lives in the commands, workflows and scripts.
- **A separate runtime plugin format and marketplace.** Rejected: unnecessary for built-in content; one package (`@kintsugi/agents`) holds it.
- **Rewriting the content from scratch.** Rejected: copying and adapting keeps the upstream method and its safety properties, and the history shows every deviation.
