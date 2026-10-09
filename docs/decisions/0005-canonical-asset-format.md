# ADR-0005: Canonical asset format = Agent Skills + AGENTS.md

- Status: Proposed
- Date: 2026-10-09

## Decision
Assets for member harnesses (skills, prompt libraries, task pack templates) are authored once in `harness/` as Agent Skills (`SKILL.md` + resources) plus `AGENTS.md` project context. `services/harness-hub` renders them into each harness's native layout (docs/reference/harness-integration.md). Runtime agents use the same `SKILL.md` format under `runtime/skills/`, which pi loads natively.

Defaults ship inside the images. A project overrides or extends them in its workspace repo under `.kintsugi/assets/` (ADR-0007).

## Consequences
Harness-specific paths (`.claude/skills`, `.github/agents`, `.agents/skills`, …) change frequently; each renderer must be verified against current harness docs and covered by snapshot tests.
