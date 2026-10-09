# AGENTS.md — guidance for coding agents working on Kintsugi

Kintsugi is a TypeScript monorepo (pnpm + Turborepo) for an AI-driven migration & modernization portal. Start at `docs/README.md` (documentation map). Read `docs/architecture/05-building-block-view.md` and `docs/architecture/concepts/runtime-and-member-harnesses.md` before making structural changes.

## Conventions
- TypeScript, ESM, Node ≥ 22, `strict` + `noUncheckedIndexedAccess`.
- Shared vocabulary lives in `packages/domain`; never redefine Phase, Disposition, Role or HarnessId elsewhere.
- Two agent worlds, kept separate:
  - **Kintsugi Runtime** (`services/runtime`): Kintsugi's built-in agents on pi, fixed in code (no agent configuration in any repo, ADR-0014), behind `packages/runtime-sdk`. They never write to project repos.
  - **Member harnesses** (Claude Code, Copilot, ChatGPT/Codex), served by `services/harness-hub` through `packages/harness-sdk`. Kintsugi supplies context and ingests results; it does not drive them.
- pi-specific code lives only in `services/runtime`. Harness-specific rendering and telemetry code lives only in `services/harness-hub`.
- Kintsugi ships no stack-specific content. Stack/project specifics belong in a project's rulebook (`rulebook/` in its workspace repo, ADR-0011); the neutral starter lives in `templates/workspace/`.
- Member-harness assets are **agent plugins in the Claude Code plugin format** (ADR-0015): the built-in plugin lives in `plugins/kintsugi/`, and stack-specific plugins live in project rulebooks (`packs/<pack>/plugins/`). Validate with `claude plugin validate --strict`. Do not hand-write harness-specific copies (`.claude/skills`, `.github/agents`, …); marketplaces and fallback renderings are generated.
- Pin `@earendil-works/*` packages to exact versions.
- Architecture decisions go in `docs/decisions/NNNN-title.md` (copy `docs/decisions/template.md`); update the decision register in `docs/decisions/README.md`.
- Documentation follows Diátaxis + arc42 (see `docs/README.md` → Conventions): English, company-neutral, one purpose per page, facts in one place.
- Deployment is a self-hosted Docker Compose package: no Kubernetes, no multi-tenancy, Postgres is the only datastore, Git is the source of truth for documents (ADR-0006/0007/0010). Do not add infrastructure dependencies without an ADR.
- Keep the engine small (ADR-0014): no code graph or language parsers, no unit-discovery configuration, no runtime-agent configuration in repos. Built-in agents are defined in `services/runtime`.

## Commits
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <subject>`, with a lowercase imperative subject.
  - Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  - Breaking changes: `!` after the type/scope, or a `BREAKING CHANGE:` footer.
- Example: `feat(rulebook): add scoped capability maturity`.
- Do not add AI co-author or attribution trailers.

## Commands
- `pnpm install` · `pnpm typecheck` · `pnpm build` · `pnpm test`

## Security
- Never run the pi runtime against customer code outside a sandbox, and always mount the code read-only (ADR-0004).
- Never commit credentials; use `.env` (gitignored) locally.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
