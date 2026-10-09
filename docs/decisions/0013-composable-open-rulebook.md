# ADR-0013: Composable, open rulebook

- Status: Accepted. Decisions 7 and 8 superseded by [ADR-0014](0014-no-code-graph-no-agent-config.md).
- Date: 2026-10-09
- Decision register: D36, D37, D38, D39, D40, D41
- Amends: ADR-0011 (rulebook structure), ADR-0004 (runner images), ADR-0005 (harness renderers), ADR-0012 (unit frontmatter)

## Context
An audit of the first rulebook design (ADR-0011) found it open at the data level (plain files in Git, Agent Skills, provenance) but rigid in structure:

| # | Rigidity | Why it hurts |
|---|---|---|
| 1 | One rulebook per project | Portfolios mix stack pairs |
| 2 | A fixed capability enum | Projects need `data-migration`, `security`, `performance`… |
| 3 | Runners restricted to the `kintsugi-runner` image | Compare needs JDK / .NET SDK / COBOL toolchains |
| 4 | Built-in, undefined pipeline templates | Projects cannot add or remove stages |
| 5 | Coarse maturity, no suspend or waiver | Readiness differs per unit kind; a rule found wrong cannot be stopped; teams get hard-blocked |
| 6 | Copy-only reuse | Copies drift and cannot be upgraded |
| 7 | One parsing strategy | Estates mix languages |
| 8 | File-glob-only unit discovery | Many units are not one file |
| 9 | Closed runtime agents, no runtime MCP | Projects cannot add a profiler agent or read-only Jira/DB access |
| 10 | Hard-coded member harness list | A new harness requires a code change |
| 11 | Prose-only rules | Rules cannot be filtered per unit |
| 12 | Version declared in two files | Drift and friction |
| 13 | No impact analysis when rules change | Affected units go unnoticed |
| 14 | No schema extension or migration path | Every schema change breaks rulebooks |

## Decision

The full structure is in the [rulebook reference](../reference/rulebook.md).

1. **Packs.** A rulebook is a set of **packs**: one per stack pair or per concern, e.g. `org-baseline`, `security`.
   - Applications select packs in `kintsugi.yaml`; `defaults.packs` apply to all applications.
   - **Precedence**, lowest to highest: vendored (`extends`) → local packs, in listed order → `overrides/<application>/` → `overrides/<application>/<module>/`.
   - **Merging**: files merge by rule ID. A later layer replaces an entry with the same ID; everything else is additive.
2. **Open capabilities.** Kintsugi defines well-known capabilities: `understand`, `conventions`, `mapping`, `convert`, `review`, `compare`, `cutover`. Rulebooks may declare custom ones. Which capabilities a stage needs is declared by the pipeline, not in code.
3. **Declarative pipelines.**
   - `pipelines/*.yaml` define phases, stages, performers (runtime agent, member role, runner), required capabilities and gates.
   - Custom phases map to a built-in phase category for reporting.
   - Built-in definitions are templates to copy.
   - Each application selects its pipeline.
4. **Scoped maturity, suspend, waivers.**
   - Maturity can be scoped per unit kind and per application.
   - New state `suspended` stops dependent stages immediately.
   - Promotions list their `evidence`.
   - **Waivers** (`waivers/W-###.yaml`) allow a stage to run despite missing readiness. Each waiver has a scope, a reason, an approver and an expiry; it is approved by PR and audited.
   - When several packs provide a required capability for a unit, **all** of them must satisfy it.
5. **Runner images.**
   - Each runner declares its container `image`, `command`, resources and network (`none` by default).
   - The worker accepts only images matching the installation's **image allowlist**.
   - Runners get the same hardening as runtime jobs, mount only the job directory, and never receive LLM credentials.
6. **Controlled `extends`.**
   - External rulebooks or packs are **vendored** into `vendor/<id>@<version>/`, pinned and committed.
   - `kintsugi rulebook upgrade` fetches a new version, shows the diff and opens a PR.
   - The vendored maturity is ignored: the project declares its own, defaulting to `draft`.
   - Nothing is distributed or upgraded silently (ADR-0011 still holds).
7. **Per-language parsing and multi-source discovery.**
   - `parsing.languages[]`: `{glob, strategy, language | extractor}`.
   - `units.discovery[]`: by glob, by extractor, by code-graph query, or declared manually.
8. **Project runtime agents and runtime MCP.**
   - Projects may define runtime agents (`agents/*.yaml`) composed only of built-in tools and allowlisted MCP servers.
   - Budgets cannot exceed installation limits.
   - Enabling them requires owner approval (PR) and the installation setting `allowProjectAgents`.
   - Runtime MCP servers must be on the installation allowlist; the egress proxy follows automatically.
9. **Harness registry.**
   - `MemberHarnessId` is an open string.
   - Renderers are declarative configs: asset → path + format transformer. Built-in configs cover Claude Code, Copilot, Codex and ChatGPT.
   - Installations can add configs, and so can projects (`harnesses/*.yaml`, approved by owners). Admins can install transformer plugins.
10. **Structured rules.**
    - One rule per file for mappings, UI patterns and review rules.
    - Frontmatter holds `id`, `title`, `appliesTo` (packs / kinds / applications / globs), `severity`, `check` and `relatesTo`.
    - `task-planner` includes in a task pack only the rules that apply to the unit.
11. **Single version, impact analysis, schema evolution.**
    - **Version**:
      - Only `rulebook.yaml` carries `version`; `kintsugi.yaml` points to the rulebook path.
      - Provenance records `version` + workspace-repo commit.
    - **Impact analysis**:
      - Units record `rulesApplied`.
      - When a rule changes, the units that applied it get `stale` and appear in a re-review queue.
    - **Schema evolution**:
      - Schemas are published as JSON Schema, generated from the `packages/domain` types.
      - Unknown `x-*` fields are preserved and ignored.
      - `kintsugi rulebook migrate` upgrades `schemaVersion` through a PR.

## Consequences
- Multi-stack portfolios, custom stages and custom capabilities need no Kintsugi changes. New harnesses usually do not either.
- Runner and harness extensibility widens the trust boundary. It is controlled by installation-level allowlists and owner approval, and every exception is audited.
- Resolution (packs, overrides, vendor, waivers) is more complex. Kintsugi must show the **resolved view** per unit (which rule came from which layer) and validate on every rulebook change.
- Existing ADR-0011 guarantees are unchanged:
  - the rulebook is a project artifact;
  - there is no silent distribution;
  - readiness gating applies;
  - provenance is recorded.
