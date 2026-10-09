# ADR-0005: Canonical asset format = Agent Skills + AGENTS.md

- Status: Superseded by [ADR-0015](0015-member-assets-as-agent-plugins.md) (assets are agent plugins); harness renderers remain as fallback per [ADR-0013](0013-composable-open-rulebook.md).
- Date: 2026-10-09

## Decision
Assets for member harnesses (skills, prompt libraries, task pack templates) are authored once in `harness/` as Agent Skills (`SKILL.md` + resources) plus `AGENTS.md` project context. `services/harness-hub` renders them into each harness's native layout (docs/reference/harness-integration.md). Built-in runtime agents use the same `SKILL.md` format for their skills, which pi loads natively; those skills are part of the agent code in `services/runtime` (ADR-0014).

Kintsugi's builtin assets are stack-agnostic and ship inside the images. Stack-specific skills, conventions and task-pack templates belong to the project rulebook (`rulebook/` in the workspace repo, ADR-0011). Both use the same canonical formats and are rendered together.

## Consequences
Harness-specific paths (`.claude/skills`, `.github/agents`, `.agents/skills`, …) change frequently; each renderer must be verified against current harness docs and covered by snapshot tests.
