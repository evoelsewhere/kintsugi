# Built-in modernization content

Kintsugi ships this modernization method as data and scripts in `@kintsugi/agents`; it is not a Claude Code plugin. The content guides a project from read-only understanding, through a human-approved direction, to member-led target work and evidence-based verification. Runtime jobs and member harnesses are deliberately separate: Kintsugi runs the former, supplies context to the latter, and the portal presents evidence and collects decisions.

## Stages and ownership

| Stage | What happens | Who runs it |
| --- | --- | --- |
| Scope and preflight | Confirm the application, source revision, access boundaries, target and constraints; surface missing inputs before work begins. | Portal task and runtime job; a person supplies or confirms project-specific answers. |
| Understand | Assess the source, identify architecture and data flows, map units, extract business rules, and record security findings. | Runtime jobs using the five read-only built-in analysis agents and deterministic scripts. Source is mounted read-only. |
| Decide | Review rule candidates and security findings, choose or revise the modernization brief, and approve the target direction and track. | Human through portal tasks and gates; runtime agents provide evidence, not approval. |
| Modernize | Transform, uplift, or reimagine the target. The selected member workflow provides assessment context and specialist prompts. | Member harness and member agents in the target repository. Kintsugi does not drive those harnesses or write their repository. |
| Verify and review | Compare target behavior with approved equivalence cases, inspect proof and remaining gaps, and decide whether to accept, revise, or stop. | Scripts and runtime jobs compute evidence; a person reviews failures, security risks, and acceptance before merge or release. |
| Follow progress | Read artifacts, show stage/evidence state, and link the next human or member action. | Portal. Reader logic is included here as a pure data layer; the portal owns the future progress panel. |

The 13 files under `commands/` describe individual tasks, their audience (`runtime`, `member`, or `portal`), inputs, outputs, and gates. `workflows/` describes orchestration and fan-out. `agents/` contains five runtime understanding agents (`legacy-analyst`, `business-rules-extractor`, `architecture-critic`, `security-auditor`, and `version-delta-analyst`) and three member agents (`test-engineer`, `uplift-migrator`, and `scaffolder`). The command metadata and ADR-0027 are authoritative when this overview is less specific than an individual workflow.

### Human decision points

- Confirm source scope, application identity, target, and any project constraints at preflight; no agent can widen the source scope or write to it.
- Review extracted rules, architecture/data observations, and security findings; correct omissions and resolve critical or conflicting findings.
- Approve or revise the modernization brief, including the target direction and modernization track, before member implementation proceeds.
- Review equivalence cases and every failed or inconclusive comparison. A computed match is evidence, not an automatic business acceptance.
- Decide whether to remediate security findings, accept residual risk, merge target changes, or release. The hook and agents never make these approvals.

## Repository and artifact boundaries

| Location | Repository/owner | Contents and write boundary |
| --- | --- | --- |
| Legacy repository at the recorded job commit | Project legacy repository | Runtime jobs and readers may read it only. It is mounted read-only; no job, script, or member workflow writes or commits source changes. |
| `assessment/<app>/` | Project document repository | Durable understanding evidence such as assessment, topology, business rules, brief, data objects, security findings, verification, and review records. Runtime output is collected here only after lifecycle checks and the applicable gate. |
| `golden/<unit>/cases/` and `golden/<unit>/fresh/` | Project document repository | Human-reviewed baseline inputs and captured legacy outputs for equivalence. |
| `runs/<unit>/<run-id>/` | Job scratch/output namespace | Ephemeral output from a new implementation run. It is not committed as golden data and is not a place to store credentials. |
| Target repository | Separate project target repository | Member harnesses make target changes here. Kintsugi supplies context and ingests results; it does not edit or commit the target repository. |

For reader functions, `reader/layout.ts` exposes logical namespaces: `assessment/<app>/`, `source/<app>/`, `target/<app>/`, `golden/<unit>/`, and `runs/<unit>/<run-id>/`. The portal's `ReaderFs` adapter routes the source and target namespaces to their respective repositories/revisions. Source access remains read-only. Golden cases and the small per-run reports in `runs/` are committed; the new side's raw outputs stay in a scratch folder and are never committed. Job scripts use only their declared read-only inputs, private scratch directory, and job output directory. The JobOutput hook scans candidate output before it can be committed.

## Package contents

- `agents/`: runtime and member agent definitions. Runtime definitions use kernel tools only; member definitions are context assets and are not converted into runtime jobs.
- `commands/`: task contracts for assessment, mapping, rules, hardening, the per-unit AS-IS specification (`understand`, Kintsugi's own), review, verification, and the selected modernization route.
- `workflows/`: runtime job fan-out and member workflow specifications, with the audience distinction kept explicit.
- `scripts/`: deterministic standard-library helpers used by script steps; they do not replace a human approval gate.
- `hooks/job_output.py`: server-side lifecycle check for credential-shaped values and required artifact shape; see [hooks/JOB-OUTPUT.md](hooks/JOB-OUTPUT.md).
- `hooks/reader/`: pure TypeScript artifact parsers and progress snapshot computation for future portal reuse. No plugin registration, host API, pane rendering, telemetry, or writes remain.
- `tests/`: Vitest tests for the retained readers; `hooks/tests/` contains Python tests for JobOutput. The TypeScript reader tests are included in the `@kintsugi/agents` suite and in `builtin/tsconfig.json`; run `pnpm --filter @kintsugi/agents test` and `pnpm --filter @kintsugi/agents typecheck`. Run the hook tests with `python -m pytest -q packages/agents/builtin/hooks/tests` from the repository root.

## Portal note

Upstream plugin preferences that remain meaningful belong to the portal, not this package: `system` becomes the project `app` selector, and the `track` choice may be `auto`, `transform`, `uplift`, or `reimagine`. A portal may also decide whether progress opens automatically or only on request; this is a portal presentation preference, not a job setting. The old command prefix is not applicable because built-in content is not exposed as plugin slash commands. `xray` depended on a Claude Code read hook and was removed with the host integration; no equivalent is promised here. No telemetry preference or collection remains.

The reader code currently returns progress data only. A future portal integration must supply a read-only adapter, map returned suggestions to portal actions, and decide the UI and preference persistence; no progress panel is shipped by `packages/agents/builtin`.

## Provenance and license

This content is adapted from Anthropic's `code-modernization` plugin in [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official), pinned at commit `c8874f5ad883e26428f483ffa4d537cc81489e64`. The upstream method and safety properties are preserved where they fit Kintsugi's execution model; host-specific presentation, registration, and telemetry are not. See [`NOTICE`](NOTICE), [`CHANGELOG.md`](CHANGELOG.md), and [`LICENSE`](LICENSE) for provenance, adaptation changes, and license terms.
