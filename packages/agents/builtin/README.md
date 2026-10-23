# Built-in modernization content

Kintsugi ships this modernization method as data and scripts in `@kintsugi/agents`; each plugin follows the Claude Code plugin layout. The content guides a project from read-only understanding, through a human-approved direction, to member-led target work. Runtime jobs and member harnesses are deliberately separate: Kintsugi runs the former, supplies context to the latter, and the portal presents evidence and collects decisions.

## Stages and ownership

| Stage | What happens | Who runs it |
| --- | --- | --- |
| Scope | Confirm the application, source revision, access boundaries, target and constraints; surface missing inputs before work begins. | Portal task and runtime job; a person supplies or confirms project-specific answers. |
| Understand | Assess the source, identify architecture and data flows, map units, extract business rules, and record security findings. | Runtime jobs using the five read-only built-in analysis agents and deterministic scripts. Source is mounted read-only. |
| Decide | Review rule candidates and security findings, and approve the requirements, the capabilities that matter and the target architecture. | Human through portal tasks and gates; runtime agents provide evidence, not approval. |
| Design | Each unit's basic and detail design, generated from the project's own templates (`01-standards/templates/`, ADR-0044, ADR-0045, ADR-0049); then the common design (architecture and common components) and the skeleton of the target repositories. | The `design` stage on the runtime (the `designer` agent), reviewed in its pull request; member harness with the member agents (`scaffolder`, `architecture-critic`) and the foundation team for the common design and the skeleton. Kintsugi does not drive those harnesses or write their repository. |
| Implement | Build each unit from its approved detail design, with unit tests, and bring the design back in line with the code. | Member harness and member agents in the target repository. |
| Follow progress | Read artifacts, show stage/evidence state, and link the next human or member action. | Portal. Reader logic is included here as a pure data layer; the portal owns the future progress panel. |

The files under `commands/` describe individual tasks, their audience (`runtime`, `member`, or `portal`), inputs, outputs, and gates. `workflows/` describes orchestration and fan-out. `agents/` contains the runtime understanding agents (`legacy-analyst`, `business-rules-extractor`, `understand-planner`, `architecture-critic`, and `security-auditor`), the runtime `designer`, and two member agents (`test-engineer` and `scaffolder`). The command metadata and ADR-0027 are authoritative when this overview is less specific than an individual workflow.

### Human decision points

- Confirm source scope, application identity, target, and any project constraints before work begins; no agent can widen the source scope or write to it.
- Review extracted rules, 02-architecture/data observations, and security findings; correct omissions and resolve critical or conflicting findings.
- Approve the P0 capabilities and the architecture (the two gates of `design-architecture`), and the design of each unit at its stage gate, before member implementation proceeds.
- Decide whether to remediate security findings, accept residual risk, or merge target changes. The hook and agents never make these approvals.

## Repository and artifact boundaries

| Location | Repository/owner | Contents and write boundary |
| --- | --- | --- |
| Legacy repository at the recorded job commit | Project legacy repository | Runtime jobs and readers may read it only. It is mounted read-only; no job, script, or member workflow writes or commits source changes. |
| `10-applications/<app>/` | Project document repository | Durable understanding and modernization evidence (ADR-0051): `01-legacy/` (the assess outputs and tools at its top; per unit `<module>/<unit>/` the specification, rules, findings and trace), `02-modern/` (the requirements and the application's design at its top; per unit `<module>/<unit>/` the card `README.md` and one folder per design set), `_generated/` (rebuilt aggregates). Gate decisions are recorded in the portal. Runtime output is collected here only after lifecycle checks and the applicable gate. |
| Target repository | Separate project target repository | Member harnesses make target changes here. Kintsugi supplies context and ingests results; it does not edit or commit the target repository. |

Paths of the document repository are built only in `packages/domain/src/document-layout.ts` (mirrored by `scripts/paths.py`). Job scripts use only their declared read-only inputs, private scratch directory, and job output directory. The JobOutput hook scans candidate output before it can be committed.

## Package contents

The content is a set of **plugins** (ADR-0035), one folder each under `plugins/`, in the Claude Code plugin format extended with `workflows/` and `scripts/`. The portal's Administration → Plugins lists them.

| Plugin | Audience | What it carries |
| --- | --- | --- |
| `understand` | runtime | Commands `assess` and `understand`; the agents `legacy-analyst`, `business-rules-extractor` and `security-auditor`; the workflows `extract-rules`, `harden-scan` and `portfolio-assess`; the item-catalog, rules, findings and work-item scripts; the JobOutput hook and the artifact readers. |
| `design` | runtime | The command `design` and the agent `designer`: one design set for a selection of units; the design-set scripts (`scaffold_design.py`, `check_design.py`, `validate_design_templates.py`) with their shared fixtures. Requires `reverse_engineering`. |
| `modernize` | member | Commands `design-architecture`, `scaffold` and `implement`; the agents `test-engineer`, `scaffolder` and `architecture-critic`; the `scaffold` workflow. Requires `reverse_engineering` and `design` (`implement` runs `check_design.py`). |
| `access` | member | The kintsugi-task skill: cited task context and workflow evidence through read-only local MCP tools. No hooks, scripts or dependency on method plugins. |
| `review` | runtime | The constrained gate-reviewer agent and its canonical report schema for fixed-revision member PR review. |

Inside a plugin folder:

- `.claude-plugin/plugin.json`: name, version, description (the Claude plugin manifest). `kintsugi.json`: title, audience (`runtime` or `member`) and `requires`.
- `skills/`: shared skills that agents load by name (`skills:` in an agent file). `skills/mermaid-diagrams` is the WH-2099 mermaid skill as published (ADR-0036): a workflow and an index of 23 Mermaid diagram types; its `references/` hold the syntax of each type and the configuration pages. A runtime job gets `SKILL.md` in the system prompt and the `references/`, `scripts/` and `assets/` files read-only beside its inputs, listed in the prompt for the agent to read on demand.
- `agents/`: runtime and member agent definitions. Runtime definitions use kernel tools only; member definitions are context assets and are not converted into runtime jobs.
- `commands/`: task contracts, one per stage. A runtime command declares the flow its stage runs in `metadata.flow`; a test in the orchestrator keeps it equal to the stage plan.
- `workflows/`: runtime job fan-out and member workflow specifications, with the audience distinction kept explicit.
- `scripts/`: deterministic standard-library helpers used by script steps; they do not replace a human approval gate. `scripts/mermaid_lint.py` checks Mermaid diagrams (`.mmd` files and `mermaid` fences in Markdown) against the `mermaid-diagrams` rules.
- `hooks/` (in `understand`): `job_output.py` is the server-side lifecycle check for required artifact shape (see [hooks/JOB-OUTPUT.md](plugins/reverse_engineering/hooks/JOB-OUTPUT.md)); `hooks/reader/` holds the pure TypeScript artifact parsers (exported as `@kintsugi/agents/reader`, used by the API for the portal's stage results). No plugin registration, host API, pane rendering, telemetry, or writes remain.
- `tests/` and `*/tests/`: Vitest tests for the retained readers (`plugins/reverse_engineering/tests/`) and Python tests next to the scripts and the hook. A plugin stands alone, so a skill or script two plugins need (`mermaid-diagrams`, `mermaid_lint.py`) is copied into both and a test keeps the copies identical.

Run the TypeScript tests with `pnpm --filter @kintsugi/agents test` and `pnpm --filter @kintsugi/agents typecheck`; run the Python tests with `python -m pytest -q packages/agents/builtin/plugins` from the repository root.

## Portal note

Upstream plugin preferences that remain meaningful belong to the portal, not this package: `system` becomes the project `app` selector, and there is no per-application choice of strategy (ADR-0043). A portal may also decide whether progress opens automatically or only on request; this is a portal presentation preference, not a job setting. The old command prefix is not applicable because built-in content is not exposed as plugin slash commands. `xray` depended on a Claude Code read hook and was removed with the host integration; no equivalent is promised here. No telemetry preference or collection remains.



## Provenance and license

This content is adapted from Anthropic's `code-modernization` plugin in [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official), pinned at commit `c8874f5ad883e26428f483ffa4d537cc81489e64`. The upstream method and safety properties are preserved where they fit Kintsugi's execution model; host-specific presentation, registration, and telemetry are not. See [`NOTICE`](NOTICE), [`CHANGELOG.md`](CHANGELOG.md), and [`LICENSE`](LICENSE) for provenance, adaptation changes, and license terms.

`skills/mermaid-diagrams` is the [`WH-2099/mermaid-skill`](https://github.com/WH-2099/mermaid-skill) skill (`.claude/skills/mermaid`), commit `982d903`, under the MIT License, with only its frontmatter name changed; see `skills/mermaid-diagrams/LICENSE` and `NOTICE`.
